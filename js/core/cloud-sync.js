/**
 * core/cloud-sync.js - Supabase 云端同步
 *
 * 暴露函数：cloudSyncEnabled, supabaseRequest, cloudUpsert, cloudUpsertBatch,
 *          cloudFetchAll, pushAppDataToCloud, pushWechatDataToCloud,
 *          pushVoiceCallDataToCloud, pushDiaryDataToCloud, pushInspirationDataToCloud,
 *          cloudPushDirty, cloudStartInterval, cloudPullFromCloud, cloudMigrateToCloud,
 *          cloudSyncNow, updateCloudSyncStatusDisplay, saveSupabaseConfig,
 *          cloudStripWechatImages, cloudStripApiAttachments,
 *          cloudEnsureAllDataLoaded, getLocalDataStats, getCloudDataStats
 * 暴露变量：_cloudSyncLastTime, _cloudSyncPushingFlags, _cloudSyncDirty, _cloudSyncIntervalId
 * 依赖：appData (data.js), saveData (storage.js),
 *       wechatData/saveWechatData (微信模块，运行时引用),
 *       voiceCallData/saveVoiceCallData (语音通话模块，运行时引用),
 *       diaryData/saveDiaryData (日记模块，运行时引用),
 *       inspirationData/saveInspirationData (碎碎念模块，运行时引用)
 */

let _cloudSyncLastTime = null;
let _cloudSyncPushingFlags = { appData: false, wechatData: false, voiceCallData: false, diaryData: false, inspirationData: false };
let _cloudSyncDirty = { appData: false, wechatData: false, voiceCallData: false, diaryData: false, inspirationData: false };
let _cloudSyncIntervalId = null;

function cloudSyncEnabled() {
    return !!(appData.settings.supabaseUrl && appData.settings.supabaseKey);
}

// 同步暂停开关：为 true 时跳过所有推送和拉取
function isCloudSyncPaused() {
    return !!appData.settings.cloudSyncPaused;
}

function toggleCloudSyncPaused() {
    appData.settings.cloudSyncPaused = !appData.settings.cloudSyncPaused;
    saveData();
    updateCloudSyncPausedUI();
    updateCloudSyncStatusDisplay();
}

function updateCloudSyncPausedUI() {
    const toggle = document.getElementById('cloudSyncPausedToggle');
    if (toggle) toggle.checked = !!appData.settings.cloudSyncPaused;
    const warning = document.getElementById('cloudSyncPausedWarning');
    if (warning) warning.style.display = appData.settings.cloudSyncPaused ? 'block' : 'none';
}

function saveSupabaseConfig() {
    let url = (document.getElementById('supabaseUrlInput').value || '').trim();
    if (url.endsWith('/')) url = url.replace(/\/+$/, '');
    appData.settings.supabaseUrl = url;
    appData.settings.supabaseKey = (document.getElementById('supabaseKeyInput').value || '').trim();
    saveData();
    updateCloudSyncStatusDisplay();
}

// PostgREST 请求封装
async function supabaseRequest(method, path, body) {
    const url = appData.settings.supabaseUrl;
    const key = appData.settings.supabaseKey;
    if (!url || !key) throw new Error('Supabase 未配置');
    const opts = {
        method,
        headers: {
            'apikey': key,
            'Authorization': 'Bearer ' + key,
            'Content-Type': 'application/json',
            'Prefer': method === 'POST' ? 'resolution=merge-duplicates' : ''
        }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const resp = await fetch(`${url}/rest/v1/${path}`, opts);
    if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        throw new Error(`Supabase ${resp.status}: ${errText}`);
    }
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('json')) return resp.json();
    return null;
}

// upsert 一条 key-value
async function cloudUpsert(key, value) {
    return supabaseRequest('POST', 'data_store', {
        key,
        value,
        updated_at: new Date().toISOString()
    });
}

// 批量 upsert 多条
async function cloudUpsertBatch(records) {
    if (!records.length) return;
    return supabaseRequest('POST', 'data_store', records);
}

// 读取所有数据（limit=10000 避免默认 1000 条限制）
async function cloudFetchAll() {
    return supabaseRequest('GET', 'data_store?select=key,value,updated_at&limit=10000');
}

// 剥离 base64 图片（微信消息）
function cloudStripWechatImages(data) {
    const stripped = JSON.parse(JSON.stringify(data));
    for (const assistantId of Object.keys(stripped.conversations || {})) {
        const conv = stripped.conversations[assistantId];
        if (conv && conv.messages) {
            conv.messages = conv.messages.map(msg => {
                if (msg.type === 'image' && msg.content && msg.content.startsWith('data:')) {
                    return { ...msg, content: '[图片:' + (msg.fileName || 'unknown') + ']' };
                }
                return msg;
            });
        }
    }
    return stripped;
}

// 剥离 base64 附件（API模式消息）
function cloudStripApiAttachments(messagesMap) {
    const stripped = {};
    for (const convId of Object.keys(messagesMap)) {
        stripped[convId] = messagesMap[convId].map(msg => {
            const m = { ...msg };
            // 剥离 attachments 中的 base64 preview
            if (m.attachments && m.attachments.length) {
                m.attachments = m.attachments.map(att => {
                    if (att.preview && att.preview.startsWith('data:')) {
                        return { ...att, preview: '[图片:' + (att.name || 'unknown') + ']' };
                    }
                    return att;
                });
            }
            // 剥离 apiContent 中的 base64 图片
            if (Array.isArray(m.apiContent)) {
                m.apiContent = m.apiContent.map(part => {
                    if (part.type === 'image_url' && part.image_url && part.image_url.url && part.image_url.url.startsWith('data:')) {
                        return { type: 'image_url', image_url: { url: '[图片]' } };
                    }
                    return part;
                });
            }
            return m;
        });
    }
    return stripped;
}

// 推送 appData 到云端
async function pushAppDataToCloud() {
    if (!cloudSyncEnabled() || isCloudSyncPaused() || _cloudSyncPushingFlags.appData) return;
    _cloudSyncPushingFlags.appData = true;
    updateCloudSyncStatusDisplay('syncing');
    try {
        const records = [];
        const now = new Date().toISOString();
        // 设置
        records.push({ key: 'app_settings', value: { settings: appData.settings, ttsSettings: appData.ttsSettings }, updated_at: now });
        // 助手
        records.push({ key: 'app_assistants', value: appData.assistants, updated_at: now });
        // 供应商
        records.push({ key: 'app_providers', value: appData.providers, updated_at: now });
        // 对话列表 + 当前状态
        records.push({ key: 'app_conversations', value: { conversations: appData.conversations, currentConversationId: appData.currentConversationId, currentAssistantId: appData.currentAssistantId }, updated_at: now });
        // 当日总结（API模式旧版）
        if (appData.dailySummaries && Object.keys(appData.dailySummaries).length > 0) {
            records.push({ key: 'daily_summaries', value: appData.dailySummaries, updated_at: now });
        }
        // 记忆核心数据
        if (appData.dailySummaryCards && appData.dailySummaryCards.length > 0) {
            records.push({ key: 'daily_summary_cards', value: appData.dailySummaryCards, updated_at: now });
        }
        if (appData.observationCards && appData.observationCards.length > 0) {
            records.push({ key: 'observation_cards', value: appData.observationCards, updated_at: now });
        }
        if (appData.dailySummarySettings) {
            records.push({ key: 'daily_summary_settings', value: appData.dailySummarySettings, updated_at: now });
        }
        // Partner 数据
        if (appData.partner) {
            records.push({ key: 'app_partner', value: appData.partner, updated_at: now });
        }
        // 每个对话的消息（剥离图片）
        const strippedMessages = cloudStripApiAttachments(appData.messages);
        for (const convId of Object.keys(strippedMessages)) {
            records.push({ key: 'app_msgs_' + convId, value: strippedMessages[convId], updated_at: now });
        }
        await cloudUpsertBatch(records);
        _cloudSyncLastTime = new Date();
        updateCloudSyncStatusDisplay('success');
        console.log('[云端同步] appData 推送成功，' + records.length + ' 条记录');
    } catch (e) {
        console.error('[云端同步] appData 推送失败:', e);
        updateCloudSyncStatusDisplay('error', e.message);
    } finally {
        _cloudSyncPushingFlags.appData = false;
    }
}

// 推送 wechatData 到云端
async function pushWechatDataToCloud() {
    if (!cloudSyncEnabled() || isCloudSyncPaused() || _cloudSyncPushingFlags.wechatData) return;
    _cloudSyncPushingFlags.wechatData = true;
    updateCloudSyncStatusDisplay('syncing');
    try {
        const records = [];
        const now = new Date().toISOString();
        // 微信状态
        records.push({ key: 'wechat_state', value: { currentAssistantId: wechatData.currentAssistantId, importedAssistants: wechatData.importedAssistants, pendingMessages: wechatData.pendingMessages || [] }, updated_at: now });
        // 每个助手的对话（剥离图片）
        const stripped = cloudStripWechatImages(wechatData);
        for (const assistantId of Object.keys(stripped.conversations || {})) {
            records.push({ key: 'wechat_conv_' + assistantId, value: stripped.conversations[assistantId], updated_at: now });
        }
        await cloudUpsertBatch(records);
        _cloudSyncLastTime = new Date();
        updateCloudSyncStatusDisplay('success');
        console.log('[云端同步] wechatData 推送成功，' + records.length + ' 条记录');
    } catch (e) {
        console.error('[云端同步] wechatData 推送失败:', e);
        updateCloudSyncStatusDisplay('error', e.message);
    } finally {
        _cloudSyncPushingFlags.wechatData = false;
    }
}

// 推送 voiceCallData 到云端
async function pushVoiceCallDataToCloud() {
    if (!cloudSyncEnabled() || isCloudSyncPaused() || _cloudSyncPushingFlags.voiceCallData) return;
    _cloudSyncPushingFlags.voiceCallData = true;
    updateCloudSyncStatusDisplay('syncing');
    try {
        const records = [];
        const now = new Date().toISOString();
        records.push({ key: 'vc_settings', value: voiceCallData.settings, updated_at: now });
        for (const record of (voiceCallData.records || [])) {
            records.push({ key: 'vc_record_' + record.id, value: record, updated_at: now });
        }
        await cloudUpsertBatch(records);
        _cloudSyncLastTime = new Date();
        updateCloudSyncStatusDisplay('success');
        console.log('[云端同步] voiceCallData 推送成功，' + records.length + ' 条记录');
    } catch (e) {
        console.error('[云端同步] voiceCallData 推送失败:', e);
        updateCloudSyncStatusDisplay('error', e.message);
    } finally {
        _cloudSyncPushingFlags.voiceCallData = false;
    }
}

// 推送有变化的数据到云端（由定时器或 visibilitychange 调用）
async function cloudPushDirty() {
    if (!cloudSyncEnabled() || isCloudSyncPaused()) return;
    if (getLocalDataStats().total === 0) { console.warn('[云端同步] 本地数据为空，跳过自动推送'); return; }
    if (_cloudSyncDirty.appData) { _cloudSyncDirty.appData = false; await pushAppDataToCloud(); }
    if (_cloudSyncDirty.wechatData) { _cloudSyncDirty.wechatData = false; await pushWechatDataToCloud(); }
    if (_cloudSyncDirty.voiceCallData) { _cloudSyncDirty.voiceCallData = false; await pushVoiceCallDataToCloud(); }
    if (_cloudSyncDirty.diaryData) { _cloudSyncDirty.diaryData = false; await pushDiaryDataToCloud(); }
    if (_cloudSyncDirty.inspirationData) { _cloudSyncDirty.inspirationData = false; await pushInspirationDataToCloud(); }
}

// 启动定时同步（每5分钟检查一次，有变化才推送）
function cloudStartInterval() {
    if (_cloudSyncIntervalId) return;
    _cloudSyncIntervalId = setInterval(() => { cloudPushDirty(); }, 5 * 60 * 1000);
}

// 推送 diaryData 到云端
async function pushDiaryDataToCloud() {
    if (!cloudSyncEnabled() || isCloudSyncPaused() || _cloudSyncPushingFlags.diaryData) return;
    _cloudSyncPushingFlags.diaryData = true;
    try {
        const now = new Date().toISOString();
        const records = [];
        records.push({ key: 'diary_state', value: { currentAssistantId: diaryData.currentAssistantId }, updated_at: now });
        for (const assistantId of Object.keys(diaryData.diaries || {})) {
            records.push({ key: 'diary_' + assistantId, value: diaryData.diaries[assistantId], updated_at: now });
        }
        if (records.length) await cloudUpsertBatch(records);
        _cloudSyncLastTime = new Date();
        updateCloudSyncStatusDisplay('success');
        console.log('[云端同步] diaryData 推送成功，' + records.length + ' 条记录');
    } catch (e) {
        console.error('[云端同步] diaryData 推送失败:', e);
        updateCloudSyncStatusDisplay('error', e.message);
    } finally {
        _cloudSyncPushingFlags.diaryData = false;
    }
}

// 推送碎碎念数据到云端
async function pushInspirationDataToCloud() {
    if (!cloudSyncEnabled() || isCloudSyncPaused() || _cloudSyncPushingFlags.inspirationData) return;
    _cloudSyncPushingFlags.inspirationData = true;
    try {
        const now = new Date().toISOString();
        const records = [{ key: 'inspiration_data', value: inspirationData, updated_at: now }];
        await cloudUpsertBatch(records);
        _cloudSyncLastTime = new Date();
        updateCloudSyncStatusDisplay('success');
        console.log('[云端同步] inspirationData 推送成功');
    } catch (e) {
        console.error('[云端同步] inspirationData 推送失败:', e);
        updateCloudSyncStatusDisplay('error', e.message);
    } finally {
        _cloudSyncPushingFlags.inspirationData = false;
    }
}

// 从云端拉取全部数据并恢复
async function cloudPullFromCloud() {
    if (!cloudSyncEnabled()) { alert('请先配置 Supabase 地址和 Key'); return; }
    if (isCloudSyncPaused()) { alert('云端同步已暂停，请先关闭暂停开关'); return; }
    if (!confirm('从云端恢复数据会覆盖当前本地数据，确定要继续吗？')) return;
    updateCloudSyncStatusDisplay('syncing');
    try {
        const rows = await cloudFetchAll();
        if (!rows || !rows.length) { alert('云端没有找到任何数据'); updateCloudSyncStatusDisplay('success'); return; }
        const dataMap = {};
        rows.forEach(r => { dataMap[r.key] = r.value; });

        // 恢复 appData
        if (dataMap['app_settings']) {
            if (dataMap['app_settings'].settings) appData.settings = { ...appData.settings, ...dataMap['app_settings'].settings };
            if (dataMap['app_settings'].ttsSettings) appData.ttsSettings = { ...appData.ttsSettings, ...dataMap['app_settings'].ttsSettings };
        }
        if (dataMap['app_assistants']) appData.assistants = dataMap['app_assistants'];
        if (dataMap['app_providers']) appData.providers = dataMap['app_providers'];
        if (dataMap['app_conversations']) {
            appData.conversations = dataMap['app_conversations'].conversations || [];
            appData.currentConversationId = dataMap['app_conversations'].currentConversationId;
            appData.currentAssistantId = dataMap['app_conversations'].currentAssistantId;
        }
        // 恢复当日总结（API模式旧版）
        if (dataMap['daily_summaries']) {
            appData.dailySummaries = dataMap['daily_summaries'];
        }
        // 恢复记忆核心数据
        if (dataMap['daily_summary_cards']) {
            appData.dailySummaryCards = dataMap['daily_summary_cards'];
        }
        if (dataMap['observation_cards']) {
            appData.observationCards = dataMap['observation_cards'];
        }
        if (dataMap['daily_summary_settings']) {
            appData.dailySummarySettings = dataMap['daily_summary_settings'];
        }
        // 恢复 partner
        if (dataMap['app_partner']) {
            appData.partner = { ...appData.partner, ...dataMap['app_partner'] };
        }
        // 恢复消息
        appData.messages = {};
        for (const key of Object.keys(dataMap)) {
            if (key.startsWith('app_msgs_')) {
                const convId = key.replace('app_msgs_', '');
                appData.messages[convId] = dataMap[key];
            }
        }
        saveData();

        // 恢复 wechatData
        if (dataMap['wechat_state']) {
            wechatData.currentAssistantId = dataMap['wechat_state'].currentAssistantId;
            wechatData.importedAssistants = dataMap['wechat_state'].importedAssistants || [];
            wechatData.pendingMessages = dataMap['wechat_state'].pendingMessages || [];
        }
        wechatData.conversations = {};
        for (const key of Object.keys(dataMap)) {
            if (key.startsWith('wechat_conv_')) {
                const assistantId = key.replace('wechat_conv_', '');
                wechatData.conversations[assistantId] = dataMap[key];
            }
        }
        saveWechatData();

        // 恢复 voiceCallData
        if (dataMap['vc_settings']) voiceCallData.settings = { ...voiceCallData.settings, ...dataMap['vc_settings'] };
        voiceCallData.records = [];
        for (const key of Object.keys(dataMap)) {
            if (key.startsWith('vc_record_')) {
                voiceCallData.records.push(dataMap[key]);
            }
        }
        voiceCallData.records.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
        saveVoiceCallData();

        // 恢复 diaryData
        if (dataMap['diary_state']) {
            diaryData.currentAssistantId = dataMap['diary_state'].currentAssistantId;
        }
        diaryData.diaries = {};
        for (const key of Object.keys(dataMap)) {
            if (key.startsWith('diary_') && key !== 'diary_state') {
                const assistantId = key.replace('diary_', '');
                diaryData.diaries[assistantId] = dataMap[key];
            }
        }
        saveDiaryData();

        // 恢复碎碎念数据
        if (dataMap['inspiration_data']) {
            inspirationData = { ...inspirationData, ...dataMap['inspiration_data'] };
            _inspirationDataLoaded = true;
            saveInspirationData();
        }

        alert('数据恢复成功！页面将刷新。');
        location.reload();
    } catch (e) {
        console.error('[云端同步] 拉取失败:', e);
        alert('从云端恢复失败：' + e.message);
        updateCloudSyncStatusDisplay('error', e.message);
    }
}

// 确保微信、语音通话、日记数据已加载（它们是懒加载的）
async function cloudEnsureAllDataLoaded() {
    if (!_wechatDataLoaded) {
        await initWechatData();
    }
    if (!_voiceCallDataLoaded) {
        await loadVoiceCallData();
    }
    // 日记数据从 localStorage 加载
    loadDiaryData();
    // 碎碎念数据加载
    if (!_inspirationDataLoaded) {
        await loadInspirationData();
    }
}

// 统计本地数据量
function getLocalDataStats() {
    const wechatConvCount = wechatData?.conversations ? Object.keys(wechatData.conversations).length : 0;
    let wechatMsgCount = 0;
    if (wechatData?.conversations) {
        for (const conv of Object.values(wechatData.conversations)) {
            wechatMsgCount += conv.messages?.length || 0;
        }
    }
    const apiConvCount = appData.conversations?.length || 0;
    let apiMsgCount = 0;
    for (const msgs of Object.values(appData.messages || {})) {
        apiMsgCount += Array.isArray(msgs) ? msgs.length : 0;
    }
    return { wechatConvCount, wechatMsgCount, apiConvCount, apiMsgCount, total: wechatMsgCount + apiMsgCount };
}

// 统计云端数据量（快速检查）
async function getCloudDataStats() {
    try {
        const rows = await cloudFetchAll();
        let wechatConvCount = 0;
        let wechatMsgCount = 0;
        let apiConvCount = 0;
        for (const row of rows) {
            if (row.key.startsWith('wechat_conv_')) {
                wechatConvCount++;
                wechatMsgCount += row.value?.messages?.length || 0;
            }
            if (row.key === 'app_conversations') {
                apiConvCount = row.value?.conversations?.length || 0;
            }
        }
        return { wechatConvCount, wechatMsgCount, apiConvCount, total: wechatMsgCount };
    } catch(e) {
        console.warn('[云端同步] 获取云端统计失败:', e);
        return null;
    }
}

// 一键上传全部本地数据到云端
async function cloudMigrateToCloud() {
    if (!cloudSyncEnabled()) { alert('请先配置 Supabase 地址和 Key'); return; }
    if (isCloudSyncPaused()) { alert('云端同步已暂停，请先关闭暂停开关'); return; }
    await cloudEnsureAllDataLoaded();
    const local = getLocalDataStats();
    const cloud = await getCloudDataStats();

    if (cloud && cloud.total > 0 && local.total < cloud.total * 0.5) {
        const msg = `⚠️ 本地数据明显少于云端！\n\n`
            + `本地: ${local.wechatMsgCount} 条微信消息, ${local.apiConvCount} 个API对话\n`
            + `云端: ${cloud.wechatMsgCount} 条微信消息, ${cloud.apiConvCount} 个API对话\n\n`
            + `继续上传会覆盖云端数据！\n如果你是新设备，请取消并用「从云端恢复」。\n\n确定要用本地数据覆盖云端吗？`;
        if (!confirm(msg)) return;
    } else {
        if (!confirm('将本地所有数据上传到云端（已有的云端数据会被覆盖），确定吗？')) return;
    }

    updateCloudSyncStatusDisplay('syncing');
    try {
        await pushAppDataToCloud();
        await pushWechatDataToCloud();
        await pushVoiceCallDataToCloud();
        await pushDiaryDataToCloud();
        await pushInspirationDataToCloud();
        alert('上传完成！你的数据已安全备份到云端。');
    } catch (e) {
        console.error('[云端同步] 迁移失败:', e);
        alert('上传失败：' + e.message);
    }
}

// 立即同步
async function cloudSyncNow() {
    if (!cloudSyncEnabled()) { alert('请先配置 Supabase 地址和 Key'); return; }
    if (isCloudSyncPaused()) { alert('云端同步已暂停，请先关闭暂停开关'); return; }
    try {
        await cloudEnsureAllDataLoaded();
        const local = getLocalDataStats();
        if (local.total === 0) {
            console.warn('[云端同步] 本地数据为空，跳过推送');
            return;
        }
        await pushAppDataToCloud();
        await pushWechatDataToCloud();
        await pushVoiceCallDataToCloud();
        await pushDiaryDataToCloud();
        await pushInspirationDataToCloud();
        // 清除脏标记
        for (const k of Object.keys(_cloudSyncDirty)) _cloudSyncDirty[k] = false;
    } catch (e) {
        console.error('[云端同步] 手动同步失败:', e);
    }
}

// 同步状态显示
function updateCloudSyncStatusDisplay(status, detail) {
    const el = document.getElementById('cloudSyncStatus');
    if (!el) return;
    if (!cloudSyncEnabled()) {
        el.textContent = '未配置';
        el.style.color = '#888';
        return;
    }
    if (isCloudSyncPaused()) {
        el.textContent = '⏸ 同步已暂停';
        el.style.color = '#f57c00';
        return;
    }
    if (status === 'syncing') {
        el.textContent = '同步中...';
        el.style.color = '#1976d2';
    } else if (status === 'success') {
        const timeStr = _cloudSyncLastTime ? _cloudSyncLastTime.toLocaleTimeString('zh-CN') : '--';
        el.textContent = '最后同步: ' + timeStr;
        el.style.color = '#388e3c';
    } else if (status === 'error') {
        el.textContent = '同步失败' + (detail ? ': ' + detail.substring(0, 50) : '');
        el.style.color = '#d32f2f';
    } else {
        el.textContent = '已配置，等待同步';
        el.style.color = '#888';
    }
}

// 页面切出时立即推送有变化的数据
document.addEventListener('visibilitychange', () => {
    if (document.hidden && cloudSyncEnabled()) {
        cloudPushDirty();
    }
});

// 启动定时同步
cloudStartInterval();
