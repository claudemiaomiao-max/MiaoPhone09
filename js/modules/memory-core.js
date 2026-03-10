/**
 * 7秒以外 · 记忆核心 App
 *
 * 负责：当日总结生成/管理、观察区管理、注入聊天上下文
 * 暴露函数：openMemoryCoreApp, closeMemoryCoreApp, switchMemoryCoreTab,
 *           mcGenerateSummary, mcEditCard, mcSaveCardEdit, mcCancelCardEdit, mcDeleteCard,
 *           mcEditObs, mcSaveObsEdit, mcCancelObsEdit, mcDeleteObs,
 *           mcSaveSettings, buildDailySummaryInjection
 * 依赖：appData/saveData (data.js/storage.js), wechatData/initWechatData (wechat-core.js),
 *        mlabConfig (memory-lab.js), cloudSyncEnabled/cloudUpsert/_cloudSyncDirty (cloud-sync.js),
 *        openPage/closePage (navigation.js), escapeHtml (ui.js)
 */

// ==================== 数据结构 ====================
// appData.dailySummaryCards = []      — 当日总结卡片
// appData.observationCards = []       — 观察区条目
// appData.dailySummarySettings = { injectCount: 15 }

let _mcCurrentTab = 'summary'; // 'summary' | 'observation'

// ==================== 页面生命周期 ====================

async function openMemoryCoreApp() {
    // 确保 wechatData 已加载
    await initWechatData();

    // 初始化数据
    if (!appData.dailySummaryCards) appData.dailySummaryCards = [];
    if (!appData.observationCards) appData.observationCards = [];
    if (!appData.dailySummarySettings) appData.dailySummarySettings = { injectCount: 15 };

    // 设置默认日期为昨天
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    document.getElementById('mcDateInput').value = dateStr;

    // 恢复注入条数
    document.getElementById('mcInjectCount').value = appData.dailySummarySettings.injectCount || 15;

    // 渲染
    mcRenderSummaryCards();

    openPage('memoryCoreAppPage');
}

function closeMemoryCoreApp() {
    closePage('memoryCoreAppPage');
}

// ==================== Tab 切换 ====================

function switchMemoryCoreTab(tab) {
    _mcCurrentTab = tab;
    document.getElementById('mcTabSummary').classList.toggle('active', tab === 'summary');
    document.getElementById('mcTabObservation').classList.toggle('active', tab === 'observation');
    document.getElementById('mcSummaryPanel').style.display = tab === 'summary' ? 'flex' : 'none';
    document.getElementById('mcObservationPanel').style.display = tab === 'observation' ? 'block' : 'none';

    if (tab === 'observation') {
        mcRenderObservationCards();
    }
}

// ==================== 设置保存 ====================

function mcSaveSettings() {
    if (!appData.dailySummarySettings) appData.dailySummarySettings = {};
    const count = parseInt(document.getElementById('mcInjectCount').value) || 15;
    appData.dailySummarySettings.injectCount = Math.max(1, Math.min(50, count));
    document.getElementById('mcInjectCount').value = appData.dailySummarySettings.injectCount;
    saveData();
}

// ==================== 生成当日总结 ====================

async function mcGenerateSummary() {
    const dateStr = document.getElementById('mcDateInput').value;
    if (!dateStr) {
        alert('请先选择日期');
        return;
    }

    // 检查提示词
    if (!mlabConfig.dailySummaryPrompt || mlabConfig.dailySummaryPrompt.trim().length < 10) {
        alert('请先在 Memory Lab 配置中填写当日总结提示词');
        return;
    }
    if (!mlabConfig.model) {
        alert('请先在 Memory Lab 配置中选择总结模型');
        return;
    }

    const btn = document.getElementById('mcGenerateBtn');
    btn.disabled = true;
    btn.textContent = '生成中...';

    try {
        // 确保 wechatData 已加载
        await initWechatData();

        const curAssistant = appData.assistants.find(a => a.id === wechatData?.currentAssistantId);
        if (!curAssistant) {
            alert('请先在微信模式中选择一个助手');
            return;
        }

        const conv = wechatData.conversations?.[curAssistant.id];
        if (!conv || !conv.messages || conv.messages.length === 0) {
            alert('该助手无聊天记录');
            return;
        }

        // 筛选当天消息
        const dayStart = new Date(dateStr + 'T00:00:00').getTime();
        const dayEnd = new Date(dateStr + 'T23:59:59.999').getTime();
        const dayMessages = conv.messages.filter(m => {
            if (!m.timestamp) return false;
            const ts = typeof m.timestamp === 'number' ? m.timestamp : new Date(m.timestamp).getTime();
            return ts >= dayStart && ts <= dayEnd;
        });

        if (dayMessages.length === 0) {
            alert('该日期无聊天记录');
            return;
        }

        // 构建请求
        const [providerId, modelId] = mlabConfig.model.split('||');
        const provider = appData.providers.find(p => p.id === providerId);
        if (!provider) throw new Error('供应商未找到');

        const dateParts = dateStr.split('-');
        const dateFormatted = `${dateParts[0]}/${parseInt(dateParts[1])}/${parseInt(dateParts[2])}`;
        const prompt = mlabConfig.dailySummaryPrompt.replace(/\{date\}/g, dateFormatted);

        const userName = appData.settings.userName || '用户';
        const assistantName = curAssistant.name || '助手';
        const dialogueText = dayMessages.map(m => {
            const role = m.role === 'user' ? userName : assistantName;
            const content = m.type === 'image' ? '[图片]' : (m.content || '');
            return `${role}: ${content}`;
        }).join('\n');

        const fullContent = prompt + '\n\n---\n\n以下是聊天记录：\n\n' + dialogueText;

        // 调用 API
        const response = await fetch(provider.baseUrl + provider.apiPath, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + provider.apiKey
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{ role: 'user', content: fullContent }],
                temperature: mlabConfig.temperature
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
        }

        const result = await response.json();
        const rawContent = result.choices?.[0]?.message?.content || '';
        console.log('[记忆核心] 当日总结原始输出:', rawContent.substring(0, 300));

        // 解析 JSON
        let parsed = null;
        let jsonText = rawContent;
        const codeBlockMatch = rawContent.match(/```json\s*([\s\S]*?)```/);
        if (codeBlockMatch) jsonText = codeBlockMatch[1].trim();
        const objMatch = jsonText.match(/\{[\s\S]*\}/);
        if (objMatch) jsonText = objMatch[0];

        try {
            parsed = JSON.parse(jsonText);
        } catch(e) {
            try {
                if (typeof mlabFixJsonQuotes === 'function') {
                    parsed = JSON.parse(mlabFixJsonQuotes(jsonText));
                }
            } catch(e2) {
                console.warn('[记忆核心] JSON 解析失败:', e2.message);
            }
        }

        if (!parsed || !parsed.daily_memory) {
            alert('总结生成失败：无法解析返回结果\n\n原始输出：\n' + rawContent.substring(0, 500));
            return;
        }

        const now = new Date().toISOString();
        const modelName = provider.models?.find(m => m.id === modelId)?.name || modelId;

        // 存入 dailySummaryCards
        const cardId = 'ds_' + Date.now();
        const card = {
            id: cardId,
            date: dateStr,
            daily_memory: parsed.daily_memory,
            model: modelName,
            assistant_id: curAssistant.id,
            created_at: now
        };
        if (!appData.dailySummaryCards) appData.dailySummaryCards = [];
        appData.dailySummaryCards.push(card);

        // 存入 observationCards
        const observations = parsed.observations || [];
        if (!appData.observationCards) appData.observationCards = [];
        observations.forEach(o => {
            const content = typeof o === 'string' ? o : (o.content || '');
            if (content.trim()) {
                appData.observationCards.push({
                    id: 'obs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    date: dateStr,
                    content: content,
                    source_summary_id: cardId,
                    assistant_id: curAssistant.id,
                    created_at: now
                });
            }
        });

        saveData();
        _cloudSyncDirty.appData = true;

        // 同步到 Supabase
        if (cloudSyncEnabled()) {
            try {
                const syncNow = new Date().toISOString();
                await cloudUpsertBatch([
                    { key: 'daily_summary_cards', value: appData.dailySummaryCards, updated_at: syncNow },
                    { key: 'observation_cards', value: appData.observationCards, updated_at: syncNow },
                    { key: 'daily_summary_settings', value: appData.dailySummarySettings, updated_at: syncNow }
                ]);
            } catch(e) {
                console.warn('[记忆核心] 云端同步失败:', e);
            }
        }

        // 渲染
        mcRenderSummaryCards();
        console.log(`[记忆核心] 总结生成成功: ${dateStr}, ${observations.length} 条观察`);

    } catch(err) {
        alert('生成失败: ' + err.message);
        console.error('[记忆核心] 生成当日总结失败:', err);
    } finally {
        btn.disabled = false;
        btn.textContent = '生成总结';
    }
}

// ==================== 当日总结卡片渲染 ====================

function mcRenderSummaryCards() {
    const container = document.getElementById('mcSummaryCards');
    const cards = appData.dailySummaryCards || [];

    if (cards.length === 0) {
        container.innerHTML = '<div class="mc-empty">还没有当日总结<br>选择日期后点击「生成总结」</div>';
        return;
    }

    // 按日期倒序排列
    const sorted = [...cards].sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return new Date(b.created_at) - new Date(a.created_at);
    });

    // 计算哪些日期在注入范围内
    const injectCount = appData.dailySummarySettings?.injectCount || 15;
    const uniqueDates = [...new Set(sorted.map(c => c.date))];
    const activeDates = new Set(uniqueDates.slice(0, injectCount));

    let html = '';
    sorted.forEach(card => {
        const isActive = activeDates.has(card.date);
        const dateObj = new Date(card.date + 'T00:00:00');
        const dateTitle = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
        const createdAt = new Date(card.created_at);
        const createdStr = `生成于 ${String(createdAt.getMonth() + 1).padStart(2, '0')}-${String(createdAt.getDate()).padStart(2, '0')} ${String(createdAt.getHours()).padStart(2, '0')}:${String(createdAt.getMinutes()).padStart(2, '0')}`;

        html += `<div class="mc-card ${isActive ? '' : 'mc-card-dim'}" id="mc-card-${card.id}">`;
        html += `<div class="mc-card-header">`;
        html += `<div class="mc-card-date">${dateTitle}</div>`;
        html += `<div class="mc-card-meta">${createdStr} · ${escapeHtml(card.model || '')}</div>`;
        html += `</div>`;
        html += `<div class="mc-card-content" id="mc-content-${card.id}">${escapeHtml(card.daily_memory || '')}</div>`;
        html += `<div class="mc-card-actions">`;
        html += `<button class="mc-btn-sm" onclick="mcEditCard('${card.id}')">编辑</button>`;
        html += `<button class="mc-btn-sm mc-btn-danger" onclick="mcDeleteCard('${card.id}')">删除</button>`;
        html += `</div>`;
        html += `</div>`;
    });

    container.innerHTML = html;
}

// ==================== 卡片编辑/删除 ====================

function mcEditCard(cardId) {
    const card = appData.dailySummaryCards.find(c => c.id === cardId);
    if (!card) return;

    const contentDiv = document.getElementById('mc-content-' + cardId);
    contentDiv.innerHTML = `<textarea class="mc-edit-textarea" id="mc-edit-${cardId}">${escapeHtml(card.daily_memory || '')}</textarea>
        <div class="mc-edit-actions">
            <button class="mc-btn-sm" onclick="mcSaveCardEdit('${cardId}')">保存</button>
            <button class="mc-btn-sm" onclick="mcCancelCardEdit('${cardId}')">取消</button>
        </div>`;
}

function mcSaveCardEdit(cardId) {
    const card = appData.dailySummaryCards.find(c => c.id === cardId);
    if (!card) return;
    const textarea = document.getElementById('mc-edit-' + cardId);
    if (!textarea) return;

    card.daily_memory = textarea.value;
    saveData();
    _cloudSyncDirty.appData = true;
    mcRenderSummaryCards();
}

function mcCancelCardEdit(cardId) {
    mcRenderSummaryCards();
}

function mcDeleteCard(cardId) {
    if (!confirm('确定要删除这条总结吗？')) return;

    appData.dailySummaryCards = appData.dailySummaryCards.filter(c => c.id !== cardId);
    saveData();
    _cloudSyncDirty.appData = true;

    // 同步云端
    if (cloudSyncEnabled()) {
        cloudUpsert('daily_summary_cards', appData.dailySummaryCards).catch(e => {
            console.warn('[记忆核心] 云端同步失败:', e);
        });
    }

    mcRenderSummaryCards();
}

// ==================== 观察区渲染 ====================

function mcRenderObservationCards() {
    const container = document.getElementById('mcObservationCards');
    const obs = appData.observationCards || [];

    if (obs.length === 0) {
        container.innerHTML = '<div class="mc-empty">还没有观察记录<br>生成当日总结后会自动提取</div>';
        return;
    }

    // 按日期分组，日期倒序
    const sorted = [...obs].sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return new Date(b.created_at) - new Date(a.created_at);
    });

    const groups = {};
    sorted.forEach(o => {
        if (!groups[o.date]) groups[o.date] = [];
        groups[o.date].push(o);
    });

    let html = '';
    Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach(date => {
        const dateObj = new Date(date + 'T00:00:00');
        const dateTitle = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;

        html += `<div class="mc-obs-group">`;
        html += `<div class="mc-obs-date">${dateTitle}</div>`;
        groups[date].forEach(o => {
            html += `<div class="mc-obs-item" id="mc-obs-${o.id}">`;
            html += `<div class="mc-obs-content" id="mc-obs-content-${o.id}">${escapeHtml(o.content || '')}</div>`;
            html += `<div class="mc-obs-actions">`;
            html += `<button class="mc-btn-sm" onclick="mcEditObs('${o.id}')">编辑</button>`;
            html += `<button class="mc-btn-sm mc-btn-danger" onclick="mcDeleteObs('${o.id}')">删除</button>`;
            html += `</div>`;
            html += `</div>`;
        });
        html += `</div>`;
    });

    container.innerHTML = html;
}

function mcEditObs(obsId) {
    const obs = appData.observationCards.find(o => o.id === obsId);
    if (!obs) return;

    const contentDiv = document.getElementById('mc-obs-content-' + obsId);
    contentDiv.innerHTML = `<textarea class="mc-edit-textarea mc-edit-obs-textarea" id="mc-edit-obs-${obsId}">${escapeHtml(obs.content || '')}</textarea>
        <div class="mc-edit-actions">
            <button class="mc-btn-sm" onclick="mcSaveObsEdit('${obsId}')">保存</button>
            <button class="mc-btn-sm" onclick="mcCancelObsEdit()">取消</button>
        </div>`;
}

function mcSaveObsEdit(obsId) {
    const obs = appData.observationCards.find(o => o.id === obsId);
    if (!obs) return;
    const textarea = document.getElementById('mc-edit-obs-' + obsId);
    if (!textarea) return;

    obs.content = textarea.value;
    saveData();
    _cloudSyncDirty.appData = true;
    mcRenderObservationCards();
}

function mcCancelObsEdit() {
    mcRenderObservationCards();
}

function mcDeleteObs(obsId) {
    if (!confirm('确定要删除这条观察吗？')) return;

    appData.observationCards = appData.observationCards.filter(o => o.id !== obsId);
    saveData();
    _cloudSyncDirty.appData = true;

    if (cloudSyncEnabled()) {
        cloudUpsert('observation_cards', appData.observationCards).catch(e => {
            console.warn('[记忆核心] 云端同步失败:', e);
        });
    }

    mcRenderObservationCards();
}

// ==================== 当日总结注入 ====================

/**
 * 构建当日总结注入文本（供 buildWechatRequestMessages 调用）
 * @param {string} assistantId - 当前助手 ID（预留，暂不过滤）
 * @returns {string|null} 注入文本，或 null 表示无需注入
 */
function buildDailySummaryInjection(assistantId) {
    const cards = appData.dailySummaryCards || [];
    if (cards.length === 0) return null;

    const injectCount = appData.dailySummarySettings?.injectCount || 15;

    // 按日期倒序
    const sorted = [...cards].sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return new Date(b.created_at) - new Date(a.created_at);
    });

    // 按日期去重（同一日期取最新一张）
    const seen = new Set();
    const deduped = [];
    for (const card of sorted) {
        if (!seen.has(card.date)) {
            seen.add(card.date);
            deduped.push(card);
        }
    }

    // 取前 N 条
    const toInject = deduped.slice(0, injectCount);
    if (toInject.length === 0) return null;

    // 拼接注入文本
    let text = `【记忆调用规则】
你的记忆方式跟人一样——不是数据库检索，是脑海中模模糊糊地浮现。
当你需要引用记忆时，遵循以下规则：
1. 严禁说出具体日期。不要说"2月8号""3月10号那天"。唯一例外是纪念日等本身关于日期的事。
2. 时间表达必须用模糊的人类感知：前几天、上次、之前有一次、前阵子、好像是上个月。
3. 不确定的事必须带模糊标记：好像、我印象中、我记得是、大概、你让我想想。
4. 回忆的过程是互动的一部分：可以犹豫、想半天、一时想不起来、突然想到很得意、记岔了被纠正后耍赖。不要表现得像在读档案。

【嗔的近期记忆】
`;

    toInject.forEach(card => {
        text += `\n[${card.date}]\n${card.daily_memory}\n`;
    });

    return text;
}
