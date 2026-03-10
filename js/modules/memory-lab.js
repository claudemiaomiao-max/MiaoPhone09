/**
 * Memory Lab 模块
 * 负责：叙事元提取（手动/自动/历史/补漏）、向量存储检索、日志管理、编辑
 * 暴露函数：mlabStartAutoTimer, mlabStopAutoTimer, mlabSearchNarratives,
 *          loadMlabConfig, openMemoryLab
 * 依赖：appData(data.js), openPage/closePage(navigation.js), escapeHtml(ui.js),
 *       cloudSyncEnabled/cloudUpsert/supabaseRequest(cloud-sync.js), initWechatData(微信模块)
 */

// ==================== Memory Lab ====================
let mlabTestMessages = null; // 手动测试导入的消息
// P0b 自动提取状态
let mlabAutoTimer = null;          // setInterval ID
let mlabAutoRunning = false;       // 并发锁
let mlabExtractProgress = {};      // { assistantId: lastExtractedMsgIndex }
let mlabLogs = [];                 // 内存中的日志缓存
let mlabLogsLoaded = false;        // 是否已从 Supabase 加载过

let mlabConfig = {
    model: '',          // providerId||modelId
    temperature: 0.5,
    prompt: '',
    silenceTimeout: 30, // 分钟
    msgLimit: 80,       // 消息累积上限
    minThreshold: 40,   // 最小条数门槛
    siliconFlowKey: '', // SiliconFlow API Key (BGE-M3 embedding)
    // 检索参数（测试台和正式注入共用）
    searchTopK: 5,
    searchWSim: 0.5,
    searchWRec: 0.3,
    searchWImp: 0.2,
    searchContextN: 20  // 去重：上下文消息条数，过滤掉这个范围内的叙事元
};

function openMemoryLab() {
    loadMlabConfig();
    loadMlabProgress();
    openPage('memoryLabPage');
    populateMlabModelDropdown();
    // 恢复配置到UI
    document.getElementById('mlabModelSelect').value = mlabConfig.model || '';
    document.getElementById('mlabTempSlider').value = mlabConfig.temperature;
    document.getElementById('mlabTempValue').textContent = mlabConfig.temperature;
    document.getElementById('mlabPromptEditor').value = mlabConfig.prompt || '';
    document.getElementById('mlabSilenceTimeout').value = mlabConfig.silenceTimeout;
    document.getElementById('mlabMsgLimit').value = mlabConfig.msgLimit;
    document.getElementById('mlabMinThreshold').value = mlabConfig.minThreshold;
    document.getElementById('mlabSiliconFlowKey').value = mlabConfig.siliconFlowKey || '';
    // 恢复检索参数到UI
    document.getElementById('mlabSearchTopK').value = mlabConfig.searchTopK || 5;
    document.getElementById('mlabSearchContextN').value = mlabConfig.searchContextN || 20;
    document.getElementById('mlabWSimSlider').value = mlabConfig.searchWSim != null ? mlabConfig.searchWSim : 0.5;
    document.getElementById('mlabWSim').textContent = mlabConfig.searchWSim != null ? mlabConfig.searchWSim : 0.5;
    document.getElementById('mlabWRecSlider').value = mlabConfig.searchWRec != null ? mlabConfig.searchWRec : 0.3;
    document.getElementById('mlabWRec').textContent = mlabConfig.searchWRec != null ? mlabConfig.searchWRec : 0.3;
    document.getElementById('mlabWImpSlider').value = mlabConfig.searchWImp != null ? mlabConfig.searchWImp : 0.2;
    document.getElementById('mlabWImp').textContent = mlabConfig.searchWImp != null ? mlabConfig.searchWImp : 0.2;
    // 恢复自动提取开关状态
    try {
        const saved = localStorage.getItem('miaomiao_mlab_auto_enabled');
        if (saved !== null) mlabAutoEnabled = saved === '1';
    } catch(e) {}
    mlabUpdateAutoStatus();
}

function closeMemoryLab() {
    closePage('memoryLabPage');
}

function switchMlabTab(tab) {
    document.querySelectorAll('.mlab-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.mlab-tab[onclick*="${tab}"]`).classList.add('active');
    document.getElementById('mlabTestPanel').style.display = tab === 'test' ? 'block' : 'none';
    document.getElementById('mlabLogPanel').style.display = tab === 'log' ? 'block' : 'none';
    document.getElementById('mlabSearchPanel').style.display = tab === 'search' ? 'block' : 'none';
    document.getElementById('mlabConfigPanel').style.display = tab === 'config' ? 'block' : 'none';
    if (tab === 'log') { mlabLogShowCount = mlabLogPageSize; mlabRenderLogPanel(); }
}

function populateMlabModelDropdown() {
    const select = document.getElementById('mlabModelSelect');
    const enabledProviders = appData.providers.filter(p => p.models && p.models.length > 0);
    let html = '<option value="">请选择模型</option>';
    enabledProviders.forEach(p => {
        html += `<optgroup label="${p.name}">`;
        p.models.forEach(m => {
            html += `<option value="${p.id}||${m.id}">${m.name || m.id}</option>`;
        });
        html += '</optgroup>';
    });
    select.innerHTML = html;
}

function mlabSaveConfig() {
    mlabConfig.model = document.getElementById('mlabModelSelect').value;
    mlabConfig.temperature = parseFloat(document.getElementById('mlabTempSlider').value);
    mlabConfig.prompt = document.getElementById('mlabPromptEditor').value;
    mlabConfig.silenceTimeout = parseInt(document.getElementById('mlabSilenceTimeout').value) || 30;
    mlabConfig.msgLimit = parseInt(document.getElementById('mlabMsgLimit').value) || 80;
    mlabConfig.minThreshold = parseInt(document.getElementById('mlabMinThreshold').value) || 40;
    mlabConfig.siliconFlowKey = document.getElementById('mlabSiliconFlowKey').value.trim();
    try { localStorage.setItem('miaomiao_mlab_config', JSON.stringify(mlabConfig)); } catch(e) {}
}

function mlabSaveSearchParams() {
    mlabConfig.searchTopK = parseInt(document.getElementById('mlabSearchTopK').value) || 5;
    mlabConfig.searchContextN = parseInt(document.getElementById('mlabSearchContextN').value) ?? 20;
    const wSim = parseFloat(document.getElementById('mlabWSimSlider').value);
    const wRec = parseFloat(document.getElementById('mlabWRecSlider').value);
    const wImp = parseFloat(document.getElementById('mlabWImpSlider').value);
    mlabConfig.searchWSim = isNaN(wSim) ? 0.5 : wSim;
    mlabConfig.searchWRec = isNaN(wRec) ? 0.3 : wRec;
    mlabConfig.searchWImp = isNaN(wImp) ? 0.2 : wImp;
    try { localStorage.setItem('miaomiao_mlab_config', JSON.stringify(mlabConfig)); } catch(e) {}
}

function loadMlabConfig() {
    try {
        const saved = localStorage.getItem('miaomiao_mlab_config');
        if (saved) Object.assign(mlabConfig, JSON.parse(saved));
    } catch(e) {}
}

// 导入JSON文件
function mlabImportJson() {
    document.getElementById('mlabFileInput').click();
}

function mlabHandleFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            // 兼容多种格式：数组 或 {messages: [...]}
            let messages = Array.isArray(data) ? data : (data.messages || []);
            if (messages.length === 0) {
                alert('未找到消息数据');
                return;
            }
            // 标准化 role 字段（兼容导出的 "我"/助手名 格式）
            messages = messages.map(m => {
                if (m.role && m.role !== 'user' && m.role !== 'assistant') {
                    return { ...m, role: m.role === '我' ? 'user' : 'assistant' };
                }
                return m;
            });
            mlabTestMessages = messages;
            mlabRenderInputPreview(messages);
            console.log(`Memory Lab: 导入 ${messages.length} 条消息`);
        } catch(err) {
            alert('JSON 解析失败: ' + err.message);
        }
        input.value = '';
    };
    reader.readAsText(file);
}

function mlabRenderInputPreview(messages) {
    const container = document.getElementById('mlabInputPreview');
    const curAssistant = appData.assistants.find(a => a.id === wechatData?.currentAssistantId);
    const aName = curAssistant?.name || '助手';
    const uName = appData.settings.userName || '用户';
    const maxPreview = 100;
    const msgs = messages.slice(0, maxPreview);
    let html = `<div style="font-size:12px;color:#7c3aed;margin-bottom:8px;font-weight:600;">共 ${messages.length} 条消息${messages.length > maxPreview ? '（预览前100条）' : ''}</div>`;
    msgs.forEach(m => {
        const name = m.role === 'user' ? `<b style="color:#059669;">${escapeHtml(uName)}</b>` : `<b style="color:#7c3aed;">${escapeHtml(aName)}</b>`;
        const content = (m.type === 'image' ? '[图片]' : (m.content || '')).substring(0, 100);
        html += `<div style="margin-bottom:4px;">${name}: ${escapeHtml(content)}</div>`;
    });
    container.innerHTML = html;
}

function mlabClearTest() {
    mlabTestMessages = null;
    document.getElementById('mlabInputPreview').innerHTML = '<div class="mlab-placeholder">导入聊天记录 JSON 后在此预览</div>';
    document.getElementById('mlabOutputPreview').innerHTML = '<div class="mlab-placeholder">点击"提取叙事元"后在此显示结果</div>';
}

// JSON 兜底修复：清理字符串值内部的未转义引号
function mlabFixJsonQuotes(text) {
    // 逐字符扫描，在字符串值内部把裸引号替换掉
    let result = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escaped) {
            result += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            result += ch;
            escaped = true;
            continue;
        }
        if (ch === '"') {
            if (!inString) {
                inString = true;
                result += ch;
            } else {
                // 判断这个引号是字符串结束还是字符串内部的裸引号
                // 看后面的字符：如果是 , ] } : 或空白+这些，则是结束引号
                const rest = text.substring(i + 1).trimStart();
                if (rest.length === 0 || /^[,\]\}:]/.test(rest)) {
                    inString = false;
                    result += ch;
                } else {
                    // 字符串内部的裸引号，去掉
                    // result += ''; // 直接吞掉
                }
            }
        } else {
            // 中文引号也清理（在字符串内部时）
            if (inString && (ch === '\u201c' || ch === '\u201d' || ch === '\u2018' || ch === '\u2019')) {
                // 中文引号直接去掉
                continue;
            }
            result += ch;
        }
    }
    return result;
}

// 公共提取函数：调用 API + 解析 JSON，返回 { narratives, rawContent }
async function mlabExtractChunk(messages, assistantName, userName, provider, modelId) {
    const dialogueText = messages.map(m => {
        const role = m.role === 'user' ? userName : assistantName;
        const content = m.type === 'image' ? '[图片]' : (m.content || '');
        return `${role}: ${content}`;
    }).join('\n');

    const contextInfo = `\n\n【基础信息】\n- 你的名字：${assistantName}\n- 用户昵称：${userName}\n- 提取时间：${new Date().toLocaleDateString('zh-CN')}`;
    const fullPrompt = mlabConfig.prompt + contextInfo + '\n\n对话内容：\n' + dialogueText;

    const response = await fetch(provider.baseUrl + provider.apiPath, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + provider.apiKey
        },
        body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: fullPrompt }],
            temperature: mlabConfig.temperature
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
    }

    const result = await response.json();
    const rawContent = result.choices?.[0]?.message?.content || '';
    console.log('Memory Lab 原始输出:', rawContent.substring(0, 200));

    let narratives = null;
    // 先提取 JSON 数组部分
    let jsonText = rawContent;
    const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) jsonText = jsonMatch[0];

    try {
        narratives = JSON.parse(jsonText);
    } catch(e) {
        // 兜底：清理字符串值内部的未转义引号
        try {
            const cleaned = mlabFixJsonQuotes(jsonText);
            narratives = JSON.parse(cleaned);
            console.log('Memory Lab: JSON 兜底修复成功');
        } catch(e2) {
            console.warn('Memory Lab: JSON 兜底修复也失败', e2.message);
        }
    }

    return { narratives: Array.isArray(narratives) ? narratives : null, rawContent };
}

// 运行提取（手动测试用）
async function mlabRunExtract() {
    if (!mlabTestMessages || mlabTestMessages.length === 0) {
        alert('请先导入对话数据');
        return;
    }
    if (!mlabConfig.model) {
        alert('请先在"配置"页选择总结模型');
        return;
    }
    if (!mlabConfig.prompt || mlabConfig.prompt.trim().length < 10) {
        alert('请先在"配置"页填写提取提示词');
        return;
    }

    const btn = document.getElementById('mlabExtractBtn');
    btn.disabled = true;
    btn.textContent = '提取中...';
    const outputDiv = document.getElementById('mlabOutputPreview');
    outputDiv.innerHTML = '<div class="mlab-placeholder">正在调用总结模型...</div>';

    try {
        const curAssistant = appData.assistants.find(a => a.id === wechatData?.currentAssistantId);
        const assistantName = curAssistant?.name || '助手';
        const userName = appData.settings.userName || '用户';

        const [providerId, modelId] = mlabConfig.model.split('||');
        const provider = appData.providers.find(p => p.id === providerId);
        if (!provider) throw new Error('供应商未找到');

        const { narratives, rawContent } = await mlabExtractChunk(mlabTestMessages, assistantName, userName, provider, modelId);

        if (narratives) {
            mlabRenderNarratives(narratives, rawContent);
        } else {
            _mlabLastRawJson = rawContent;
            outputDiv.innerHTML = `<div style="color:#ef4444;font-size:12px;margin-bottom:8px;">JSON 解析失败，显示原始输出：</div><button onclick="mlabCopyJson()" style="margin-bottom:6px;padding:6px 14px;border:1px solid #d1d5db;border-radius:6px;background:#fff;font-size:12px;color:#374151;cursor:pointer;">复制原始输出</button><div class="mlab-raw-json">${escapeHtml(rawContent)}</div>`;
        }
    } catch(err) {
        outputDiv.innerHTML = `<div style="color:#ef4444;padding:10px;">出错: ${escapeHtml(err.message)}</div>`;
        console.error('Memory Lab 提取失败:', err);
    } finally {
        btn.disabled = false;
        btn.textContent = '提取叙事元';
    }
}

function mlabRenderNarratives(narratives, rawJson) {
    _mlabLastRawJson = rawJson;
    const container = document.getElementById('mlabOutputPreview');
    if (narratives.length === 0) {
        container.innerHTML = '<div class="mlab-placeholder">模型认为这段对话没有值得提取的记忆</div>';
        return;
    }
    let html = `<div style="font-size:12px;color:#7c3aed;margin-bottom:8px;font-weight:600;">提取到 ${narratives.length} 个叙事元</div>`;
    narratives.forEach((n, i) => {
        html += '<div class="mlab-narrative">';
        if (n.split_reason) {
            html += `<div class="mlab-split-reason">切分: ${escapeHtml(n.split_reason)}</div>`;
        }
        html += `<div class="mlab-narrative-context">${escapeHtml(n.context || '')}</div>`;
        // user_quotes
        const quotes = n.user_quotes || n.miaomiao_says || [];
        quotes.forEach(q => {
            html += `<div class="mlab-narrative-quote">"${escapeHtml(q)}"</div>`;
        });
        // assistant_summary
        if (n.assistant_summary || n.chen_response) {
            html += `<div class="mlab-narrative-summary">嗔: ${escapeHtml(n.assistant_summary || n.chen_response)}</div>`;
        }
        // tags
        html += '<div class="mlab-narrative-tags">';
        const tags = n.tags?.type || n.tags || [];
        const tagArr = Array.isArray(tags) ? tags : [tags];
        tagArr.forEach(t => {
            if (typeof t === 'string') html += `<span class="mlab-tag">${escapeHtml(t)}</span>`;
        });
        const intensity = n.tags?.emotion_intensity || n.intensity;
        if (intensity) {
            html += `<span class="mlab-tag mlab-tag-intensity">intensity: ${intensity}</span>`;
        }
        const keywords = n.tags?.topic_keywords || [];
        keywords.forEach(k => {
            html += `<span class="mlab-tag" style="background:#e0f2fe;color:#0284c7;">${escapeHtml(k)}</span>`;
        });
        html += '</div></div>';
    });
    // 原始JSON折叠
    html += `<details style="margin-top:10px;"><summary style="font-size:12px;color:#9ca3af;cursor:pointer;">查看原始 JSON</summary><div style="margin-top:6px;"><button onclick="mlabCopyJson()" style="margin-bottom:6px;padding:6px 14px;border:1px solid #d1d5db;border-radius:6px;background:#fff;font-size:12px;color:#374151;cursor:pointer;">复制 JSON</button><div class="mlab-raw-json" id="mlabRawJsonContent">${escapeHtml(rawJson)}</div></div></details>`;
    container.innerHTML = html;
}
let _mlabLastRawJson = '';

function mlabCopyJson() {
    if (!_mlabLastRawJson) return;
    navigator.clipboard.writeText(_mlabLastRawJson).then(() => {
        // 简单反馈
        const btn = event.target;
        const orig = btn.textContent;
        btn.textContent = '已复制';
        btn.style.color = '#7c3aed';
        setTimeout(() => { btn.textContent = orig; btn.style.color = '#374151'; }, 1500);
    }).catch(() => {
        // iOS Safari fallback
        const ta = document.createElement('textarea');
        ta.value = _mlabLastRawJson;
        ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const btn = event.target;
        btn.textContent = '已复制';
        btn.style.color = '#7c3aed';
        setTimeout(() => { btn.textContent = '复制 JSON'; btn.style.color = '#374151'; }, 1500);
    });
}
// ==================== Memory Lab P0b ====================

// --- 进度持久化 ---
function loadMlabProgress() {
    try {
        const saved = localStorage.getItem('miaomiao_mlab_progress');
        if (saved) mlabExtractProgress = JSON.parse(saved);
    } catch(e) {}
}

function saveMlabProgress() {
    try {
        localStorage.setItem('miaomiao_mlab_progress', JSON.stringify(mlabExtractProgress));
    } catch(e) {}
    // 备份到 Supabase（fire-and-forget）
    if (cloudSyncEnabled()) {
        cloudUpsert('mlab_progress', mlabExtractProgress).catch(e =>
            console.warn('Memory Lab: 进度备份失败', e.message)
        );
    }
}

// --- 消息预切分算法 ---
function mlabFindTurnBoundary(messages, idealIdx) {
    // 从 idealIdx 往后找 role=user 且前一条是 role=assistant 的位置
    for (let i = idealIdx; i < messages.length; i++) {
        if (messages[i].role === 'user' && i > 0 && messages[i - 1].role === 'assistant') {
            return i;
        }
    }
    // 往前找
    for (let i = idealIdx - 1; i > 0; i--) {
        if (messages[i].role === 'user' && messages[i - 1].role === 'assistant') {
            return i;
        }
    }
    return idealIdx; // fallback
}

function mlabSplitLargeChunk(chunk, minSize, maxSize) {
    if (chunk.length <= maxSize) return [chunk];
    const targetSize = 60;
    const result = [];
    let start = 0;
    while (start < chunk.length) {
        if (chunk.length - start <= maxSize) {
            result.push(chunk.slice(start));
            break;
        }
        let splitAt = start + targetSize;
        if (splitAt >= chunk.length) {
            result.push(chunk.slice(start));
            break;
        }
        // 找轮次边界
        splitAt = mlabFindTurnBoundary(chunk, splitAt);
        if (splitAt <= start) splitAt = start + targetSize; // 防死循环
        result.push(chunk.slice(start, splitAt));
        start = splitAt;
    }
    return result;
}

function mlabPreSplit(messages, skipTimeSplit) {
    const minThreshold = mlabConfig.minThreshold != null ? mlabConfig.minThreshold : 40;
    const msgLimit = mlabConfig.msgLimit != null ? mlabConfig.msgLimit : 80;

    if (messages.length <= msgLimit) {
        return messages.length >= minThreshold ? [messages] : [];
    }

    let chunks = [];

    if (!skipTimeSplit) {
        // 沉默超时 / 历史提取：按时间间隔 >30分钟 找断点
        const gaps = [];
        for (let i = 1; i < messages.length; i++) {
            const prev = new Date(messages[i - 1].timestamp).getTime();
            const curr = new Date(messages[i].timestamp).getTime();
            if (curr - prev > 30 * 60 * 1000) {
                gaps.push(i);
            }
        }

        // 调整断点到轮次边界
        const breakpoints = gaps.map(idx => mlabFindTurnBoundary(messages, idx));
        const uniqueBreaks = [...new Set(breakpoints)].sort((a, b) => a - b);

        let start = 0;
        for (const bp of uniqueBreaks) {
            if (bp > start && bp < messages.length) {
                chunks.push(messages.slice(start, bp));
                start = bp;
            }
        }
        if (start < messages.length) {
            chunks.push(messages.slice(start));
        }
    } else {
        // 累积上限：不按时间切，整批作为一个块
        chunks = [messages];
    }

    // 拆分过大的块
    let finalChunks = [];
    for (const chunk of chunks) {
        const splits = mlabSplitLargeChunk(chunk, minThreshold, msgLimit);
        finalChunks.push(...splits);
    }

    // 小于 minThreshold 的碎块合并到相邻块（不丢弃，防止进度跳过导致消息丢失）
    if (finalChunks.length > 1) {
        let merged = [];
        for (let i = 0; i < finalChunks.length; i++) {
            if (finalChunks[i].length < minThreshold) {
                // 合并到前一个块（优先）或后一个块
                if (merged.length > 0) {
                    merged[merged.length - 1] = merged[merged.length - 1].concat(finalChunks[i]);
                } else if (i + 1 < finalChunks.length) {
                    finalChunks[i + 1] = finalChunks[i].concat(finalChunks[i + 1]);
                } else {
                    merged.push(finalChunks[i]); // 只有一个碎块，保留
                }
            } else {
                merged.push(finalChunks[i]);
            }
        }
        finalChunks = merged;
    }

    return finalChunks;
}

// --- 自动提取 UI 控制 ---
let mlabAutoEnabled = true; // 默认开启（进入微信模式时自动启动）

function mlabToggleAuto() {
    const sw = document.getElementById('mlabAutoSwitch');
    mlabAutoEnabled = !mlabAutoEnabled;
    sw.classList.toggle('on', mlabAutoEnabled);
    // 先存 localStorage，再调 start（start 里会读 localStorage）
    try { localStorage.setItem('miaomiao_mlab_auto_enabled', mlabAutoEnabled ? '1' : '0'); } catch(e) {}
    if (mlabAutoEnabled) {
        mlabStartAutoTimer();
    } else {
        mlabStopAutoTimer();
    }
    mlabUpdateAutoStatus();
}

function mlabUpdateAutoStatus() {
    const el = document.getElementById('mlabAutoStatus');
    if (!el) return;
    const sw = document.getElementById('mlabAutoSwitch');
    if (sw) sw.classList.toggle('on', mlabAutoEnabled);
    if (mlabAutoTimer) {
        el.textContent = '自动提取运行中，每60秒检查一次';
        el.style.color = '#059669';
    } else {
        el.textContent = mlabAutoEnabled ? '自动提取已启用，进入微信模式后生效' : '自动提取已关闭';
        el.style.color = '#9ca3af';
    }
}

async function mlabShowProgress() {
    await initWechatData();
    const el = document.getElementById('mlabProgressInfo');
    if (!el) return;
    const conversations = wechatData?.conversations;
    if (!conversations) { el.textContent = '无对话数据'; return; }

    let html = '';
    for (const assistantId of Object.keys(conversations)) {
        const assistant = appData.assistants.find(a => a.id === assistantId);
        if (!assistant || !assistant.vectorMemoryEnabled) continue;
        const conv = conversations[assistantId];
        if (!conv?.messages) continue;
        const progress = mlabExtractProgress[assistantId];
        if (progress == null) { html += `${assistant.name}: 未初始化<br>`; continue; }
        const total = conv.messages.length - 1;
        const unprocessed = total - progress;
        const progressMsg = conv.messages[progress];
        const progressTime = progressMsg?.timestamp ? new Date(progressMsg.timestamp).toLocaleString('zh-CN') : '未知';
        html += `${assistant.name}: 进度 ${progress}/${total} (未处理${unprocessed}条) · 截止 ${progressTime}<br>`;
    }
    el.innerHTML = html || '无已启用向量记忆的助手';
}

function mlabResetProgress() {
    if (!confirm('确定重置所有助手的提取进度？\n这会让自动提取从"当前位置"重新开始，不会回溯老数据。')) return;
    const conversations = wechatData?.conversations;
    if (conversations) {
        for (const assistantId of Object.keys(conversations)) {
            const conv = conversations[assistantId];
            if (conv?.messages) {
                mlabExtractProgress[assistantId] = conv.messages.length - 1;
            }
        }
    }
    saveMlabProgress();
    mlabUpdateAutoStatus();
    alert('进度已重置，所有助手将从当前最新消息开始追踪');
}

// --- 心跳定时器 + 自动提取 ---
function mlabStartAutoTimer() {
    if (mlabAutoTimer) return;
    // 加载开关状态
    try {
        const saved = localStorage.getItem('miaomiao_mlab_auto_enabled');
        if (saved !== null) mlabAutoEnabled = saved === '1';
    } catch(e) {}
    if (!mlabAutoEnabled) {
        console.log('Memory Lab: 自动提取已关闭，跳过启动');
        return;
    }
    loadMlabConfig();
    loadMlabProgress();
    mlabAutoTimer = setInterval(mlabAutoHeartbeat, 60 * 1000);
    console.log('Memory Lab: 自动提取心跳已启动');
    // 立即做一次检查
    setTimeout(mlabAutoHeartbeat, 2000);
}

function mlabStopAutoTimer() {
    if (mlabAutoTimer) {
        clearInterval(mlabAutoTimer);
        mlabAutoTimer = null;
        console.log('Memory Lab: 自动提取心跳已停止');
    }
}

async function mlabAutoHeartbeat() {
    if (mlabAutoRunning) return;
    if (!mlabConfig.model || !mlabConfig.prompt || mlabConfig.prompt.trim().length < 10) return;

    mlabAutoRunning = true;
    loadMlabConfig(); // 每次心跳都重新读配置，防止内存中的值过时
    try {
        const conversations = wechatData?.conversations;
        if (!conversations) return;

        for (const assistantId of Object.keys(conversations)) {
            const assistant = appData.assistants.find(a => a.id === assistantId);
            if (!assistant || !assistant.vectorMemoryEnabled) continue;

            const conv = conversations[assistantId];
            if (!conv || !conv.messages || conv.messages.length < 2) continue;

            // 首次遇到没有 progress 记录的助手：初始化为当前末尾，只追踪之后的新消息
            if (!(assistantId in mlabExtractProgress)) {
                mlabExtractProgress[assistantId] = conv.messages.length - 1;
                saveMlabProgress();
                console.log(`Memory Lab: [${assistant.name}] 首次初始化进度到 ${conv.messages.length - 1}，老数据跳过`);
                continue;
            }
            const lastExtractedIndex = mlabExtractProgress[assistantId];
            const totalMsgs = conv.messages.length - 1;
            const unprocessed = totalMsgs - lastExtractedIndex;

            if (unprocessed < (mlabConfig.minThreshold != null ? mlabConfig.minThreshold : 40)) continue;

            // 检查触发条件
            const lastMsg = conv.messages[conv.messages.length - 1];
            const silenceMs = Date.now() - new Date(lastMsg.timestamp).getTime();
            const silenceTimeout = ((mlabConfig.silenceTimeout != null ? mlabConfig.silenceTimeout : 30)) * 60 * 1000;
            const msgLimit = mlabConfig.msgLimit != null ? mlabConfig.msgLimit : 80;

            let triggerReason = null;
            if (silenceMs >= silenceTimeout) {
                triggerReason = 'silence';
            } else if (unprocessed >= msgLimit) {
                triggerReason = 'accumulation';
            }

            if (triggerReason) {
                console.log(`Memory Lab: 触发自动提取 [${assistant.name}] 原因=${triggerReason} 未处理=${unprocessed}条 (配置: msgLimit=${msgLimit}, silence=${mlabConfig.silenceTimeout}min, minThreshold=${mlabConfig.minThreshold})`);
                await mlabAutoExtract(assistantId, conv, assistant, triggerReason);
            }
        }
    } catch(err) {
        console.error('Memory Lab: 心跳出错', err);
    } finally {
        mlabAutoRunning = false;
    }
}

async function mlabAutoExtract(assistantId, conv, assistant, triggerReason) {
    const lastExtractedIndex = mlabExtractProgress[assistantId] || 0;
    // 未处理的消息（跳过 index 0 的 system 消息）
    const startIdx = Math.max(1, lastExtractedIndex + 1);
    const unprocessedMsgs = conv.messages.slice(startIdx);

    if (unprocessedMsgs.length === 0) return;

    const totalUnprocessed = unprocessedMsgs.length;
    const assistantName = assistant.name || '助手';
    const userName = appData.settings.userName || '用户';

    // 解析模型
    const [providerId, modelId] = mlabConfig.model.split('||');
    const provider = appData.providers.find(p => p.id === providerId);
    if (!provider) {
        console.warn('Memory Lab: 供应商未找到', providerId);
        return;
    }

    // 切分
    let chunks = mlabPreSplit(unprocessedMsgs, triggerReason === 'accumulation');
    if (chunks.length === 0) {
        // 切分后全部被过滤（碎块都不够门槛），但总量够触发条件
        // 回退：把整批消息当作一个块处理，避免死循环
        if (unprocessedMsgs.length >= (mlabConfig.minThreshold != null ? mlabConfig.minThreshold : 40)) {
            console.log(`Memory Lab: [${assistantName}] 切分后无有效块，回退为整批处理 (${unprocessedMsgs.length}条)`);
            chunks.push(unprocessedMsgs);
        } else {
            console.log(`Memory Lab: [${assistantName}] 消息不足最小门槛，跳过`);
            return;
        }
    }

    console.log(`Memory Lab: [${assistantName}] 切分为 ${chunks.length} 个块`);
    let allSuccess = true;
    let lastProcessedGlobalIdx = lastExtractedIndex;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const triggerTime = new Date().toISOString();
        const firstMsg = chunk[0];
        const lastMsg = chunk[chunk.length - 1];

        try {
            const { narratives, rawContent } = await mlabExtractChunk(chunk, assistantName, userName, provider, modelId);

            if (narratives) {
                const logId = 'mlog_' + Date.now() + '_' + i;
                mlabSaveLog({
                    id: logId,
                    assistantId,
                    assistantName,
                    triggerTime,
                    triggerReason,
                    chunkSize: chunk.length,
                    totalUnprocessed,
                    timeRange: { start: firstMsg.timestamp, end: lastMsg.timestamp },
                    inputMessages: chunk,
                    outputNarratives: narratives,
                    rawOutput: rawContent,
                    status: 'success'
                });
                // P0c: fire-and-forget 存入向量库
                mlabBatchStoreVectors(narratives, assistantId, logId, firstMsg.timestamp, lastMsg.timestamp).catch(e =>
                    console.warn('Memory Lab P0c: 自动向量存储失败', e.message)
                );
            } else {
                // JSON 解析失败
                mlabSaveLog({
                    id: 'mlog_' + Date.now() + '_' + i,
                    assistantId,
                    assistantName,
                    triggerTime,
                    triggerReason,
                    chunkSize: chunk.length,
                    totalUnprocessed,
                    timeRange: { start: firstMsg.timestamp, end: lastMsg.timestamp },
                    inputMessages: chunk,
                    outputNarratives: [],
                    rawOutput: rawContent,
                    status: 'parse_error',
                    error: 'JSON 解析失败'
                });
            }

            // 计算这个 chunk 最后一条消息在 conv.messages 中的全局索引
            const chunkLastInGlobal = conv.messages.indexOf(lastMsg);
            if (chunkLastInGlobal > lastProcessedGlobalIdx) {
                lastProcessedGlobalIdx = chunkLastInGlobal;
            }

        } catch(err) {
            console.error(`Memory Lab: chunk ${i} 提取失败`, err);
            mlabSaveLog({
                id: 'mlog_' + Date.now() + '_' + i,
                assistantId,
                assistantName,
                triggerTime,
                triggerReason,
                chunkSize: chunk.length,
                totalUnprocessed,
                timeRange: { start: firstMsg.timestamp, end: lastMsg.timestamp },
                inputMessages: chunk,
                outputNarratives: [],
                rawOutput: '',
                status: 'error',
                error: err.message
            });
            allSuccess = false;
            break; // API 失败不推进 progress，下次重试
        }
    }

    // 更新进度（error 时不推进，parse_error 时推进）
    if (lastProcessedGlobalIdx > lastExtractedIndex) {
        mlabExtractProgress[assistantId] = lastProcessedGlobalIdx;
        saveMlabProgress();
        console.log(`Memory Lab: [${assistantName}] 进度更新到 ${lastProcessedGlobalIdx}`);
    }
}

// --- 日志存储 ---
function mlabSaveLog(logEntry) {
    // 清理 inputMessages 中的图片 base64
    const cleanEntry = { ...logEntry };
    if (cleanEntry.inputMessages) {
        cleanEntry.inputMessages = cleanEntry.inputMessages.map(m => {
            if (m.type === 'image' && m.content && m.content.length > 200) {
                return { ...m, content: '[图片]' };
            }
            return m;
        });
    }

    // 加入内存缓存
    mlabLogs.unshift(cleanEntry);

    // 存 Supabase（fire-and-forget）
    if (cloudSyncEnabled()) {
        cloudUpsert('mlab_log_' + cleanEntry.id, cleanEntry).catch(e =>
            console.warn('Memory Lab: 日志存储失败', e.message)
        );
    }

    // 如果日志面板可见，刷新
    const logPanel = document.getElementById('mlabLogPanel');
    if (logPanel && logPanel.style.display !== 'none') {
        mlabRenderLogPanel();
    }
}

async function mlabLoadLogs() {
    if (mlabLogsLoaded) return;
    if (!cloudSyncEnabled()) {
        mlabLogsLoaded = true;
        return;
    }
    try {
        const url = appData.settings.supabaseUrl;
        const key = appData.settings.supabaseKey;
        const resp = await fetch(`${url}/rest/v1/data_store?key=like.mlab_log_*&order=updated_at.desc&limit=200`, {
            headers: {
                'apikey': key,
                'Authorization': 'Bearer ' + key
            }
        });
        if (resp.ok) {
            const rows = await resp.json();
            const serverLogs = rows.map(r => r.value).filter(Boolean);
            // 合并：以 id 去重，内存中的优先
            const existingIds = new Set(mlabLogs.map(l => l.id));
            for (const log of serverLogs) {
                if (!existingIds.has(log.id)) {
                    mlabLogs.push(log);
                }
            }
            // 按 triggerTime 降序排序
            mlabLogs.sort((a, b) => new Date(b.triggerTime) - new Date(a.triggerTime));
            console.log(`Memory Lab: 加载了 ${serverLogs.length} 条日志`);
        }
    } catch(e) {
        console.warn('Memory Lab: 加载日志失败', e.message);
    }
    mlabLogsLoaded = true;
}

let mlabLogPageSize = 30;
let mlabLogShowCount = 30;

// --- 日志面板渲染 ---
async function mlabRenderLogPanel() {
    const container = document.getElementById('mlabLogPanel');
    if (!container) return;

    // 首次加载
    if (!mlabLogsLoaded) {
        container.innerHTML = '<div class="mlab-section"><div class="mlab-placeholder" style="padding:40px 0;text-align:center;">加载日志中...</div></div>';
        await mlabLoadLogs();
    }

    if (mlabLogs.length === 0) {
        container.innerHTML = '<div class="mlab-section"><div class="mlab-placeholder" style="padding:40px 0;text-align:center;color:#999;">暂无提取日志<br><span style="font-size:12px;">开启向量记忆的助手在微信模式聊天后会自动触发提取</span></div></div>';
        return;
    }

    // 确保wechatData可用（用于计算消息序号）
    try { await initWechatData(); } catch(e) {}

    // 统计
    const today = new Date().toDateString();
    const todayCount = mlabLogs.filter(l => new Date(l.triggerTime).toDateString() === today).length;
    const showCount = Math.min(mlabLogShowCount, mlabLogs.length);
    const conversations = wechatData?.conversations;

    // 当前进度
    let progressStr = '';
    if (conversations) {
        for (const assistantId of Object.keys(conversations)) {
            const assistant = appData.assistants.find(a => a.id === assistantId);
            if (!assistant || !assistant.vectorMemoryEnabled) continue;
            const conv = conversations[assistantId];
            if (!conv?.messages) continue;
            const p = mlabExtractProgress[assistantId];
            if (p != null) {
                const total = conv.messages.length - 1;
                progressStr += `<span>进度: <b style="color:#7c3aed;">${p}/${total}</b></span>`;
            }
        }
    }

    let html = `<div class="mlab-section" style="padding-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;gap:12px;font-size:13px;color:#6b7280;flex-wrap:wrap;">
                <span>今日: <b style="color:#7c3aed;">${todayCount}</b></span>
                <span>总计: <b style="color:#7c3aed;">${mlabLogs.length}</b></span>
                <span>显示: <b style="color:#7c3aed;">${showCount}</b></span>
                ${progressStr}
                <span>${mlabAutoTimer ? '<b style="color:#059669;">运行中</b>' : '<b style="color:#9ca3af;">未启动</b>'}</span>
            </div>
            <button class="mlab-btn mlab-btn-outline" onclick="mlabExportLogs()" style="font-size:11px;padding:4px 10px;flex-shrink:0;">导出</button>
        </div>
    </div>`;

    // 计算每条日志的消息序号范围（需要wechatData）
    let msgIndexCache = {};
    function findMsgIdx(assistantId, timeStr) {
        if (!conversations || !timeStr) return null;
        const conv = conversations[assistantId];
        if (!conv?.messages) return null;
        const cacheKey = assistantId + '_' + timeStr;
        if (msgIndexCache[cacheKey] != null) return msgIndexCache[cacheKey];
        const t = new Date(timeStr).getTime();
        for (let i = 0; i < conv.messages.length; i++) {
            if (new Date(conv.messages[i].timestamp).getTime() >= t) {
                msgIndexCache[cacheKey] = i;
                return i;
            }
        }
        msgIndexCache[cacheKey] = conv.messages.length - 1;
        return conv.messages.length - 1;
    }

    html += '<div class="mlab-section" style="padding-top:0;">';
    mlabLogs.slice(0, showCount).forEach((log, idx) => {
        const time = new Date(log.triggerTime);
        const timeStr = time.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' ' + time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const reasonText = log.triggerReason === 'silence' ? '沉默超时' : log.triggerReason === 'accumulation' ? '累积上限' : (log.triggerReason || '手动');
        const statusClass = log.status === 'success' ? 'mlab-log-status-success' : log.status === 'parse_error' ? 'mlab-log-status-parse-error' : 'mlab-log-status-error';
        const statusText = log.status === 'success' ? '成功' : log.status === 'parse_error' ? '解析失败' : '错误';
        const narrativeCount = log.outputNarratives?.length || 0;

        // 消息序号范围
        let rangeStr = '';
        if (log.timeRange && log.assistantId) {
            const startIdx = findMsgIdx(log.assistantId, log.timeRange.start);
            const endIdx = findMsgIdx(log.assistantId, log.timeRange.end);
            if (startIdx != null && endIdx != null) {
                rangeStr = ` · #${startIdx}~${endIdx}`;
            }
        }

        html += `<div class="mlab-log-entry" onclick="mlabToggleLogDetail(${idx})">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:14px;font-weight:500;color:#1f2937;">${escapeHtml(log.assistantName || '未知助手')}</div>
                    <div style="font-size:12px;color:#9ca3af;margin-top:2px;">${timeStr} · ${reasonText} · ${log.totalUnprocessed ? log.totalUnprocessed + '条触发→' : ''}${log.chunkSize || 0}条入块${narrativeCount > 0 ? ' · ' + narrativeCount + '个叙事元' : ''}${rangeStr}</div>
                </div>
                <span class="${statusClass}">${statusText}</span>
            </div>
            <div class="mlab-log-detail" id="mlabLogDetail_${idx}" style="display:none;" onclick="event.stopPropagation()"></div>
        </div>`;
    });
    html += '</div>';

    if (showCount < mlabLogs.length) {
        html += `<div style="text-align:center;padding:12px 0;">
            <button class="mlab-btn mlab-btn-outline" onclick="mlabLoadMoreLogs()" style="font-size:13px;padding:8px 24px;">加载更多（还有 ${mlabLogs.length - showCount} 条）</button>
        </div>`;
    }

    container.innerHTML = html;
}

function mlabLoadMoreLogs() {
    mlabLogShowCount += mlabLogPageSize;
    mlabRenderLogPanel();
}

function mlabExportLogs() {
    if (mlabLogs.length === 0) { alert('暂无日志'); return; }
    const data = JSON.stringify(mlabLogs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mlab_logs_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function mlabToggleLogDetail(idx) {
    const detailEl = document.getElementById('mlabLogDetail_' + idx);
    if (!detailEl) return;

    if (detailEl.style.display === 'none') {
        detailEl.style.display = 'block';
        const log = mlabLogs[idx];
        if (!log) return;

        let detailHtml = '';

        // 错误信息
        if (log.error) {
            detailHtml += `<div style="color:#ef4444;font-size:12px;margin-bottom:8px;">错误: ${escapeHtml(log.error)}</div>`;
        }

        // 重新提取按钮 + 删除按钮 + 重置进度按钮
        if (log.inputMessages && log.inputMessages.length > 0) {
            detailHtml += `<div style="margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap;">
                <button class="mlab-btn mlab-btn-outline" id="mlabReExtractBtn_${idx}" onclick="mlabReExtract(${idx})" style="font-size:12px;padding:4px 12px;">重新提取</button>
                <button class="mlab-btn mlab-btn-outline" onclick="mlabRewindToLog(${idx})" style="font-size:12px;padding:4px 12px;color:#f59e0b;border-color:#fcd34d;">从这里重新同步</button>
                <button class="mlab-btn mlab-btn-outline" onclick="mlabDeleteLog(${idx})" style="font-size:12px;padding:4px 12px;color:#ef4444;border-color:#fca5a5;">删除日志</button>
            </div>`;
        } else {
            detailHtml += `<div style="margin-bottom:8px;display:flex;gap:8px;">
                <button class="mlab-btn mlab-btn-outline" onclick="mlabRewindToLog(${idx})" style="font-size:12px;padding:4px 12px;color:#f59e0b;border-color:#fcd34d;">从这里重新同步</button>
                <button class="mlab-btn mlab-btn-outline" onclick="mlabDeleteLog(${idx})" style="font-size:12px;padding:4px 12px;color:#ef4444;border-color:#fca5a5;">删除日志</button>
            </div>`;
        }

        // 叙事元卡片
        if (log.outputNarratives && log.outputNarratives.length > 0) {
            // 日志级别时间信息
            const tr = log.timeRange || {};
            const firstMsg = log.inputMessages?.[0];
            const fmtTime = (t) => { try { return new Date(t).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch(e) { return String(t); } };
            const hasTs = firstMsg?.timestamp ? '✓' : '✗';
            const hasTm = firstMsg?.time ? '✓' : '✗';
            const trStr = (tr.start || tr.end) ? `${tr.start ? fmtTime(tr.start) : '无'} ~ ${tr.end ? fmtTime(tr.end) : '无'}` : '无';
            detailHtml += `<div style="font-size:11px;color:#9ca3af;margin-bottom:6px;padding:4px 8px;background:#f9fafb;border-radius:4px;">timeRange: ${escapeHtml(trStr)} | timestamp=${hasTs} time=${hasTm} | log_id: ${escapeHtml(log.id || '无')}</div>`;

            detailHtml += `<div style="font-size:12px;color:#7c3aed;margin-bottom:6px;font-weight:600;">提取到 ${log.outputNarratives.length} 个叙事元</div>`;
            log.outputNarratives.forEach((n, nIdx) => {
                const editedClass = n.manually_edited ? ' edited' : '';
                detailHtml += `<div class="mlab-narrative${editedClass}" id="mlabNarrative_${idx}_${nIdx}">`;
                if (n.manually_edited) {
                    detailHtml += `<div style="font-size:10px;color:#a78bfa;margin-bottom:4px;">已手动编辑</div>`;
                }
                if (n.split_reason) {
                    detailHtml += `<div class="mlab-split-reason">切分: ${escapeHtml(n.split_reason)}</div>`;
                }
                detailHtml += `<div class="mlab-narrative-context">${escapeHtml(n.context || '')}</div>`;
                const quotes = n.user_quotes || n.miaomiao_says || [];
                quotes.forEach(q => {
                    detailHtml += `<div class="mlab-narrative-quote">"${escapeHtml(q)}"</div>`;
                });
                if (n.assistant_summary || n.chen_response) {
                    detailHtml += `<div class="mlab-narrative-summary">嗔: ${escapeHtml(n.assistant_summary || n.chen_response)}</div>`;
                }
                detailHtml += '<div class="mlab-narrative-tags">';
                const tags = n.tags?.type || n.tags || [];
                const tagArr = Array.isArray(tags) ? tags : [tags];
                tagArr.forEach(t => {
                    if (typeof t === 'string') detailHtml += `<span class="mlab-tag">${escapeHtml(t)}</span>`;
                });
                const intensity = n.tags?.emotion_intensity || n.intensity;
                if (intensity) detailHtml += `<span class="mlab-tag mlab-tag-intensity">intensity: ${intensity}</span>`;
                const keywords = n.tags?.topic_keywords || [];
                keywords.forEach(k => {
                    detailHtml += `<span class="mlab-tag" style="background:#e0f2fe;color:#0284c7;">${escapeHtml(k)}</span>`;
                });
                detailHtml += '</div>';
                detailHtml += `<div class="mlab-narrative-actions"><button class="mlab-narrative-edit-btn" onclick="mlabEditNarrative(${idx},${nIdx})">编辑</button></div>`;
                detailHtml += '</div>';
            });
        }

        // 原始对话折叠
        if (log.inputMessages && log.inputMessages.length > 0) {
            detailHtml += `<details style="margin-top:8px;"><summary style="font-size:12px;color:#9ca3af;cursor:pointer;">原始对话 (${log.inputMessages.length}条)</summary><div style="margin-top:6px;max-height:200px;overflow-y:auto;font-size:12px;color:#6b7280;">`;
            log.inputMessages.slice(0, 50).forEach(m => {
                const name = m.role === 'user' ? '用户' : '助手';
                const content = (m.content || '').substring(0, 80);
                detailHtml += `<div style="margin-bottom:3px;"><b>${name}:</b> ${escapeHtml(content)}</div>`;
            });
            if (log.inputMessages.length > 50) detailHtml += '<div style="color:#9ca3af;">...还有更多</div>';
            detailHtml += '</div></details>';
        }

        // 原始 JSON 折叠
        if (log.rawOutput) {
            detailHtml += `<details style="margin-top:6px;"><summary style="font-size:12px;color:#9ca3af;cursor:pointer;">原始 JSON 输出</summary><div class="mlab-raw-json" style="margin-top:6px;">${escapeHtml(log.rawOutput)}</div></details>`;
        }

        detailEl.innerHTML = detailHtml;
    } else {
        detailEl.style.display = 'none';
    }
}

// 重新提取日志中的叙事元
// 从某条日志的位置重新开始同步
async function mlabRewindToLog(logIdx) {
    const log = mlabLogs[logIdx];
    if (!log || !log.assistantId || !log.timeRange?.end) {
        alert('这条日志缺少时间或助手信息，无法定位');
        return;
    }

    await initWechatData();
    const conv = wechatData?.conversations?.[log.assistantId];
    if (!conv?.messages) { alert('找不到对话数据'); return; }

    // 找到这条日志结束时间对应的消息位置（保留本条日志，从它之后开始重提）
    const logEndTime = new Date(log.timeRange.end).getTime();
    let targetIdx = conv.messages.length - 1;
    for (let i = 0; i < conv.messages.length; i++) {
        const msgTime = new Date(conv.messages[i].timestamp).getTime();
        if (msgTime > logEndTime) {
            targetIdx = i;
            break;
        }
    }

    const currentProgress = mlabExtractProgress[log.assistantId] || 0;
    const rewindAmount = currentProgress - targetIdx;
    const targetTime = new Date(log.timeRange.end).toLocaleString('zh-CN');

    // 收集这条日志之后的同助手日志（不包含本条，本条保留）
    const logEndMs = new Date(log.timeRange.end).getTime();
    const logsToClean = mlabLogs.filter(l =>
        l.id !== log.id &&
        l.assistantId === log.assistantId &&
        l.timeRange?.start &&
        new Date(l.timeRange.start).getTime() > logEndMs
    );

    if (rewindAmount <= 0) {
        alert('当前进度已经在这条日志结尾了，不需要回退。');
        return;
    }

    let msg = `将进度回退到这条日志之后\n\n`;
    msg += `本条日志保留不动\n`;
    msg += `回退: ${rewindAmount} 条消息\n`;
    msg += `从: ${targetTime} 之后开始重新提取\n\n`;
    if (logsToClean.length > 0) {
        msg += `将自动清理这条之后的 ${logsToClean.length} 条旧日志及对应向量。`;
    } else {
        msg += `这条之后没有需要清理的旧日志。`;
    }

    if (rewindAmount > 500) {
        msg = `⚠️ 将回退 ${rewindAmount} 条消息！\n\n` + msg;
    }

    if (!confirm(msg)) return;

    // 自动清理本条之后的旧日志和向量
    if (logsToClean.length > 0) {
        try {
            for (const oldLog of logsToClean) {
                if (cloudSyncEnabled()) {
                    await mlabDeleteVectorsByLogId(oldLog.id);
                    const url = appData.settings.supabaseUrl;
                    const key = appData.settings.supabaseKey;
                    await fetch(`${url}/rest/v1/data_store?key=eq.mlab_log_${encodeURIComponent(oldLog.id)}`, {
                        method: 'DELETE',
                        headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
                    });
                }
            }
            const cleanIds = new Set(logsToClean.map(l => l.id));
            mlabLogs = mlabLogs.filter(l => !cleanIds.has(l.id));
            console.log(`Memory Lab: 已自动清理 ${logsToClean.length} 条旧日志及向量`);
        } catch(err) {
            console.warn('Memory Lab: 清理旧日志时出错', err.message);
        }
    }

    mlabExtractProgress[log.assistantId] = targetIdx;
    saveMlabProgress();
    console.log(`Memory Lab: 进度回退到日志结尾 [${log.assistantName}] ${currentProgress} → ${targetIdx}`);
    alert(`进度已回退到这条日志结尾。\n\n${logsToClean.length > 0 ? '已自动清理 ' + logsToClean.length + ' 条旧日志及向量。\n' : ''}下次心跳会从这里开始重新提取。`);
    mlabRenderLogPanel();
    mlabShowProgress();
}

// 删除日志（连带删除向量库数据，可选回退进度）
async function mlabDeleteLog(logIdx) {
    const log = mlabLogs[logIdx];
    if (!log) return;

    const timeStr = log.timeRange ? `${new Date(log.timeRange.start).toLocaleString('zh-CN')} ~ ${new Date(log.timeRange.end).toLocaleString('zh-CN')}` : '未知时间';
    if (!confirm(`确认删除这条日志？\n\n${log.assistantName} · ${timeStr}\n${log.chunkSize || 0}条消息 · ${log.outputNarratives?.length || 0}个叙事元\n\n向量库中对应的叙事元也会一起删除。`)) return;

    try {
        // 1. 删除向量库中的关联数据
        if (cloudSyncEnabled()) {
            await mlabDeleteVectorsByLogId(log.id);
        }

        // 2. 删除 Supabase 中的日志
        if (cloudSyncEnabled()) {
            const url = appData.settings.supabaseUrl;
            const key = appData.settings.supabaseKey;
            await fetch(`${url}/rest/v1/data_store?key=eq.mlab_log_${encodeURIComponent(log.id)}`, {
                method: 'DELETE',
                headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
            });
        }

        // 3. 从内存中移除
        mlabLogs.splice(logIdx, 1);

        // 4. 重新渲染
        mlabRenderLogPanel();
        showWechatToast('已删除', 'info');
        console.log(`Memory Lab: 日志已删除 ${log.id}`);

    } catch(err) {
        console.error('Memory Lab: 删除日志失败', err);
        alert('删除失败: ' + err.message);
    }
}

async function mlabReExtract(logIdx) {
    const log = mlabLogs[logIdx];
    if (!log || !log.inputMessages || log.inputMessages.length === 0) {
        alert('该日志没有原始对话数据，无法重新提取');
        return;
    }
    if (!mlabConfig.model) { alert('请先在"配置"页选择总结模型'); return; }
    if (!mlabConfig.prompt || mlabConfig.prompt.trim().length < 10) { alert('请先填写提取提示词'); return; }

    const [providerId, modelId] = mlabConfig.model.split('||');
    const provider = appData.providers.find(p => p.id === providerId);
    if (!provider) { alert('供应商未找到'); return; }

    const btn = document.getElementById('mlabReExtractBtn_' + logIdx);
    if (btn) { btn.disabled = true; btn.textContent = '提取中...'; }

    try {
        const assistantName = log.assistantName || '助手';
        const userName = appData.settings.userName || '用户';
        const { narratives, rawContent } = await mlabExtractChunk(log.inputMessages, assistantName, userName, provider, modelId);

        if (!narratives || narratives.length === 0) {
            alert('提取结果为空，可能是模型返回格式不对');
            return;
        }

        // 更新日志
        log.outputNarratives = narratives;
        log.rawOutput = rawContent;
        log.status = 'success';
        log.error = null;

        // 存日志到 Supabase
        if (cloudSyncEnabled()) {
            cloudUpsert('mlab_log_' + log.id, log).catch(e =>
                console.warn('Memory Lab: 日志更新失败', e.message)
            );
        }

        // 删除旧向量 → 存入新向量
        if (mlabConfig.siliconFlowKey && cloudSyncEnabled()) {
            await mlabDeleteVectorsByLogId(log.id);
            const tStart = log.timeRange?.start || log.inputMessages[0]?.timestamp || log.inputMessages[0]?.time;
            const tEnd = log.timeRange?.end || log.inputMessages[log.inputMessages.length - 1]?.timestamp || log.inputMessages[log.inputMessages.length - 1]?.time;
            await mlabBatchStoreVectors(narratives, log.assistantId, log.id, tStart, tEnd);
        }

        console.log(`Memory Lab 重新提取: [${assistantName}] 成功，${narratives.length}条叙事元`);

        // 重新渲染日志详情
        const detailEl = document.getElementById('mlabLogDetail_' + logIdx);
        if (detailEl) {
            detailEl.style.display = 'none';
            mlabToggleLogDetail(logIdx);
        }
    } catch (err) {
        console.error('Memory Lab 重新提取失败:', err);
        alert('重新提取失败: ' + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '重新提取'; }
    }
}

// --- P0c: 向量存储与检索 ---

async function mlabGetEmbedding(text) {
    const key = mlabConfig.siliconFlowKey;
    if (!key) throw new Error('请先在 Memory Lab 配置页填写 SiliconFlow API Key');
    const resp = await fetch('https://api.siliconflow.cn/v1/embeddings', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + key,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'BAAI/bge-m3',
            input: text,
            encoding_format: 'float'
        })
    });
    if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        throw new Error(`SiliconFlow ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    return data.data[0].embedding;
}

async function mlabStoreNarrativeVector(narrative, assistantId, logId, startTime, endTime) {
    const content = (narrative.context || '') + '\n' + (narrative.user_quotes || []).join('\n');
    const embedding = await mlabGetEmbedding(content);

    const url = appData.settings.supabaseUrl;
    const key = appData.settings.supabaseKey;
    if (!url || !key) throw new Error('Supabase 未配置');

    const id = 'nv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const record = {
        id,
        assistant_id: assistantId,
        content,
        narrative,
        embedding: `[${embedding.join(',')}]`,
        log_id: logId || null
    };
    if (startTime) record.start_time = new Date(startTime).toISOString();
    if (endTime) record.end_time = new Date(endTime).toISOString();

    const resp = await fetch(`${url}/rest/v1/mlab_narratives`, {
        method: 'POST',
        headers: {
            'apikey': key,
            'Authorization': 'Bearer ' + key,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(record)
    });
    if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        throw new Error(`存储向量失败 ${resp.status}: ${errText}`);
    }
    return id;
}

async function mlabBatchStoreVectors(narratives, assistantId, logId, startTime, endTime) {
    if (!narratives || narratives.length === 0) return;
    if (!mlabConfig.siliconFlowKey || !cloudSyncEnabled()) return;

    console.log(`Memory Lab P0c: 开始存储 ${narratives.length} 条叙事元到向量库...`);
    let stored = 0;
    for (let i = 0; i < narratives.length; i++) {
        try {
            await mlabStoreNarrativeVector(narratives[i], assistantId, logId, startTime, endTime);
            stored++;
            if (i < narratives.length - 1) {
                await new Promise(r => setTimeout(r, 200));
            }
        } catch(e) {
            console.warn(`Memory Lab P0c: 第 ${i+1} 条存储失败:`, e.message);
        }
    }
    console.log(`Memory Lab P0c: 叙事元已存入向量库 (${stored}/${narratives.length})`);
}

// 按 log_id 删除旧向量（重新提取 / 编辑前调用，防止重复）
async function mlabDeleteVectorsByLogId(logId) {
    if (!logId) return 0;
    const url = appData.settings.supabaseUrl;
    const key = appData.settings.supabaseKey;
    if (!url || !key) return 0;

    const resp = await fetch(`${url}/rest/v1/mlab_narratives?log_id=eq.${encodeURIComponent(logId)}`, {
        method: 'DELETE',
        headers: {
            'apikey': key,
            'Authorization': 'Bearer ' + key,
            'Prefer': 'return=representation'
        }
    });
    if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        console.warn(`Memory Lab: 删除旧向量失败 ${resp.status}: ${errText}`);
        return 0;
    }
    const deleted = await resp.json().catch(() => []);
    console.log(`Memory Lab: 已删除 log_id=${logId} 的旧向量 ${deleted.length} 条`);
    return deleted.length;
}

async function mlabSearchNarratives(queryText, topK, assistantId, weights) {
    const embedding = await mlabGetEmbedding(queryText);

    const url = appData.settings.supabaseUrl;
    const key = appData.settings.supabaseKey;
    if (!url || !key) throw new Error('Supabase 未配置');

    const params = {
        query_embedding: `[${embedding.join(',')}]`,
        match_count: topK || 5,
        filter_assistant_id: assistantId || null
    };
    if (weights) {
        params.w_similarity = weights.similarity;
        params.w_recency = weights.recency;
        params.w_importance = weights.importance;
    }

    const resp = await fetch(`${url}/rest/v1/rpc/match_narratives`, {
        method: 'POST',
        headers: {
            'apikey': key,
            'Authorization': 'Bearer ' + key,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
    });
    if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        throw new Error(`检索失败 ${resp.status}: ${errText}`);
    }
    return resp.json();
}

async function mlabRunSearch() {
    const queryText = document.getElementById('mlabSearchQuery').value.trim();
    if (!queryText) { alert('请输入检索文字'); return; }

    const btn = document.getElementById('mlabSearchBtn');
    const resultsDiv = document.getElementById('mlabSearchResults');
    btn.disabled = true;
    btn.textContent = '检索中...';
    resultsDiv.innerHTML = '<div class="mlab-placeholder">正在检索...</div>';

    try {
        // 先保存当前UI参数到mlabConfig
        mlabSaveSearchParams();

        const topK = mlabConfig.searchTopK || 5;
        const contextN = mlabConfig.searchContextN || 20;
        const assistantId = wechatData?.currentAssistantId || null;

        const weights = {
            similarity: mlabConfig.searchWSim != null ? mlabConfig.searchWSim : 0.5,
            recency: mlabConfig.searchWRec != null ? mlabConfig.searchWRec : 0.3,
            importance: mlabConfig.searchWImp != null ? mlabConfig.searchWImp : 0.2
        };

        // 多召回再过滤
        const results = await mlabSearchNarratives(queryText, topK * 2, assistantId, weights);

        // 上下文去重：过滤掉最近N条消息时间范围内的叙事元
        let filtered = results || [];
        if (contextN > 0 && assistantId && wechatData?.conversations?.[assistantId]) {
            const conv = wechatData.conversations[assistantId];
            const contextMessages = conv.messages.slice(-contextN);
            const earliestTimestamp = contextMessages[0]?.timestamp || null;
            if (earliestTimestamp) {
                filtered = filtered.filter(r => {
                    const endTime = r.end_time || r.narrative?.end_time;
                    if (!endTime) return true;
                    return new Date(endTime) < new Date(earliestTimestamp);
                });
            }
        }
        filtered = filtered.slice(0, topK);

        console.log(`Memory Lab 检索: 召回${(results||[]).length}条，去重后${filtered.length}条`);
        mlabRenderSearchResults(filtered);
    } catch(err) {
        resultsDiv.innerHTML = `<div style="color:#ef4444;padding:10px;font-size:13px;">检索出错: ${escapeHtml(err.message)}</div>`;
        console.error('Memory Lab 检索失败:', err);
    } finally {
        btn.disabled = false;
        btn.textContent = '检索叙事元';
    }
}

function mlabRenderSearchResults(results) {
    const container = document.getElementById('mlabSearchResults');
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="mlab-placeholder">没有找到匹配的叙事元</div>';
        return;
    }

    let html = '';
    results.forEach((r, i) => {
        const simPct = (r.similarity * 100).toFixed(1);
        const finalPct = r.final_score != null ? (r.final_score * 100).toFixed(1) : simPct;
        const simClass = (r.final_score != null ? r.final_score : r.similarity) >= 0.5 ? '' : ' low';
        const n = r.narrative || {};
        html += `<div class="mlab-search-result">`;
        html += `<div class="mlab-search-result-header">`;
        html += `<span style="font-size:12px;color:#9ca3af;">#${i + 1}</span>`;
        html += `<div style="display:flex;gap:6px;align-items:center;">`;
        html += `<span style="font-size:11px;color:#9ca3af;">语义${simPct}%</span>`;
        html += `<span class="mlab-search-similarity${simClass}">${finalPct}%</span>`;
        html += `</div></div>`;

        // 时间范围 + log_id（始终显示，方便排查）
        const fmt = (t) => { try { return new Date(t).toLocaleDateString('zh-CN', {month:'short',day:'numeric'}); } catch(e) { return ''; } };
        let metaInfo = '';
        if (r.start_time || r.end_time) {
            const timeStr = r.start_time ? fmt(r.start_time) + (r.end_time && r.end_time !== r.start_time ? ' ~ ' + fmt(r.end_time) : '') : '';
            metaInfo += timeStr;
        } else {
            metaInfo += '<span style="color:#ef4444;">无时间</span>';
        }
        if (r.log_id) metaInfo += ` · ${r.log_id.substring(0, 12)}`;
        html += `<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">${metaInfo}</div>`;

        if (n.context) html += `<div style="font-size:13px;color:#374151;margin-bottom:6px;">${escapeHtml(n.context)}</div>`;
        if (n.user_quotes && n.user_quotes.length > 0) {
            html += `<div style="font-size:12px;color:#6b7280;margin-bottom:6px;">`;
            n.user_quotes.forEach(q => {
                html += `<div style="margin-bottom:2px;">「${escapeHtml(q)}」</div>`;
            });
            html += `</div>`;
        }
        if (n.assistant_summary || n.chen_response) {
            html += `<div class="mlab-narrative-summary">嗔: ${escapeHtml(n.assistant_summary || n.chen_response)}</div>`;
        }
        if (n.emotion_label) html += `<span class="mlab-tag">${escapeHtml(n.emotion_label)}</span> `;
        if (n.memory_type) html += `<span class="mlab-tag" style="background:#e0f2fe;color:#0284c7;">${escapeHtml(n.memory_type)}</span> `;

        const tags = n.tags?.type || n.tags || [];
        const tagArr = Array.isArray(tags) ? tags : [tags];
        tagArr.forEach(t => {
            if (typeof t === 'string') html += `<span class="mlab-tag">${escapeHtml(t)}</span> `;
        });
        const intensity = n.tags?.emotion_intensity || n.intensity;
        if (intensity) html += `<span class="mlab-tag mlab-tag-intensity">intensity: ${intensity}</span> `;
        const keywords = n.tags?.topic_keywords || [];
        keywords.forEach(k => {
            html += `<span class="mlab-tag" style="background:#e0f2fe;color:#0284c7;">${escapeHtml(k)}</span> `;
        });

        html += `</div>`;
    });

    container.innerHTML = html;
}

// --- P0c: 叙事元手动编辑 ---

function mlabEditNarrative(logIdx, nIdx) {
    const log = mlabLogs[logIdx];
    if (!log || !log.outputNarratives || !log.outputNarratives[nIdx]) return;
    const n = log.outputNarratives[nIdx];
    const container = document.getElementById(`mlabNarrative_${logIdx}_${nIdx}`);
    if (!container) return;

    const quotes = n.user_quotes || n.miaomiao_says || [];
    const tags = n.tags || {};
    const tagTypes = Array.isArray(tags.type || tags) ? (tags.type || tags) : [tags.type || tags];
    const keywords = tags.topic_keywords || [];

    container.innerHTML = `
        <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px;">context（场景描述）</div>
            <textarea class="mlab-narrative-edit-field" id="mlabEditContext_${logIdx}_${nIdx}" rows="2">${escapeHtml(n.context || '')}</textarea>
        </div>
        <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px;">user_quotes（每行一条）</div>
            <textarea class="mlab-narrative-edit-field" id="mlabEditQuotes_${logIdx}_${nIdx}" rows="3">${escapeHtml(quotes.join('\n'))}</textarea>
        </div>
        <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px;">assistant_summary</div>
            <textarea class="mlab-narrative-edit-field" id="mlabEditSummary_${logIdx}_${nIdx}" rows="1">${escapeHtml(n.assistant_summary || n.chen_response || '')}</textarea>
        </div>
        <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px;">emotion_label</div>
            <input class="mlab-narrative-edit-field" id="mlabEditEmotion_${logIdx}_${nIdx}" value="${escapeHtml(n.emotion_label || '')}">
        </div>
        <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px;">memory_type</div>
            <input class="mlab-narrative-edit-field" id="mlabEditMemType_${logIdx}_${nIdx}" value="${escapeHtml(n.memory_type || '')}">
        </div>
        <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px;">tags.type（逗号分隔）</div>
            <input class="mlab-narrative-edit-field" id="mlabEditTagTypes_${logIdx}_${nIdx}" value="${escapeHtml(tagTypes.filter(t => typeof t === 'string').join(', '))}">
        </div>
        <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px;">topic_keywords（逗号分隔）</div>
            <input class="mlab-narrative-edit-field" id="mlabEditKeywords_${logIdx}_${nIdx}" value="${escapeHtml(keywords.join(', '))}">
        </div>
        <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px;">emotion_intensity (1-10)</div>
            <input type="number" class="mlab-narrative-edit-field" id="mlabEditIntensity_${logIdx}_${nIdx}" value="${n.tags?.emotion_intensity || n.intensity || ''}" min="1" max="10" style="width:80px;">
        </div>
        <div class="mlab-narrative-actions">
            <button class="mlab-narrative-edit-btn" onclick="mlabCancelEditNarrative(${logIdx},${nIdx})">取消</button>
            <button class="mlab-narrative-edit-btn primary" onclick="mlabSaveEditNarrative(${logIdx},${nIdx})">保存</button>
        </div>
    `;
}

function mlabCancelEditNarrative(logIdx, nIdx) {
    // 重新渲染整个日志详情
    const detailEl = document.getElementById('mlabLogDetail_' + logIdx);
    if (detailEl) {
        detailEl.style.display = 'none';
        mlabToggleLogDetail(logIdx);
    }
}

async function mlabSaveEditNarrative(logIdx, nIdx) {
    const log = mlabLogs[logIdx];
    if (!log || !log.outputNarratives || !log.outputNarratives[nIdx]) return;

    const n = log.outputNarratives[nIdx];
    const get = (id) => document.getElementById(id)?.value || '';

    // 读取编辑后的值
    n.context = get(`mlabEditContext_${logIdx}_${nIdx}`).trim();
    n.user_quotes = get(`mlabEditQuotes_${logIdx}_${nIdx}`).split('\n').map(s => s.trim()).filter(Boolean);
    n.assistant_summary = get(`mlabEditSummary_${logIdx}_${nIdx}`).trim();
    n.emotion_label = get(`mlabEditEmotion_${logIdx}_${nIdx}`).trim();
    n.memory_type = get(`mlabEditMemType_${logIdx}_${nIdx}`).trim();

    const tagTypesStr = get(`mlabEditTagTypes_${logIdx}_${nIdx}`);
    const keywordsStr = get(`mlabEditKeywords_${logIdx}_${nIdx}`);
    const intensityVal = parseInt(get(`mlabEditIntensity_${logIdx}_${nIdx}`)) || null;

    if (!n.tags || typeof n.tags !== 'object' || Array.isArray(n.tags)) n.tags = {};
    n.tags.type = tagTypesStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    n.tags.topic_keywords = keywordsStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (intensityVal) n.tags.emotion_intensity = intensityVal;

    n.manually_edited = true;

    // 更新日志到 Supabase
    if (cloudSyncEnabled()) {
        cloudUpsert('mlab_log_' + log.id, log).catch(e =>
            console.warn('Memory Lab: 编辑后日志保存失败', e.message)
        );
    }

    // 删除旧向量 → 重新存储该日志下所有叙事元
    if (mlabConfig.siliconFlowKey && cloudSyncEnabled()) {
        try {
            const assistantId = log.assistantId || 'unknown';
            const tr = log.timeRange || {};
            await mlabDeleteVectorsByLogId(log.id);
            await mlabBatchStoreVectors(log.outputNarratives, assistantId, log.id, tr.start, tr.end);
            console.log('Memory Lab: 编辑后叙事元已全量同步到向量库');
        } catch(e) {
            console.warn('Memory Lab: 编辑后向量同步失败', e.message);
        }
    }

    // 刷新显示
    mlabCancelEditNarrative(logIdx, nIdx);
}

// --- P0c: 历史数据提取 ---
let mlabHistoryRunning = false;
let mlabHistoryAbort = false;

// 扫描日志缺口并补提取
// 扫描孤儿向量（log_id 对不上现有日志的向量）
async function mlabScanOrphanVectors() {
    const statusEl = document.getElementById('mlabOrphanStatus');
    const btn = document.getElementById('mlabOrphanBtn');
    if (!cloudSyncEnabled()) { alert('请先配置 Supabase'); return; }

    if (btn) { btn.disabled = true; btn.textContent = '扫描中...'; }
    if (statusEl) statusEl.textContent = '正在从向量库拉取数据...';

    try {
        const url = appData.settings.supabaseUrl;
        const key = appData.settings.supabaseKey;

        // 1. 拉取向量库所有记录的 log_id（去重）
        let allVectors = [];
        let offset = 0;
        const pageSize = 1000;
        while (true) {
            const resp = await fetch(`${url}/rest/v1/mlab_narratives?select=id,log_id,content&order=id&limit=${pageSize}&offset=${offset}`, {
                headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
            });
            if (!resp.ok) throw new Error('拉取向量数据失败: ' + resp.status);
            const rows = await resp.json();
            allVectors = allVectors.concat(rows);
            if (rows.length < pageSize) break;
            offset += pageSize;
        }

        if (allVectors.length === 0) {
            if (statusEl) statusEl.textContent = '向量库为空，没有需要清理的。';
            return;
        }

        // 2. 收集所有现有日志的 log_id
        const existingLogIds = new Set(mlabLogs.map(l => l.id));

        // 3. 找出孤儿向量
        const orphans = allVectors.filter(v => v.log_id && !existingLogIds.has(v.log_id));

        // 按 log_id 分组
        const orphansByLogId = {};
        for (const v of orphans) {
            if (!orphansByLogId[v.log_id]) orphansByLogId[v.log_id] = [];
            orphansByLogId[v.log_id].push(v);
        }

        const orphanLogIds = Object.keys(orphansByLogId);

        if (orphanLogIds.length === 0) {
            if (statusEl) statusEl.innerHTML = `✅ 扫描完成，共 ${allVectors.length} 条向量，没有孤儿数据。`;
            return;
        }

        // 4. 展示结果
        let report = `扫描完成！共 ${allVectors.length} 条向量，发现 ${orphans.length} 条孤儿向量（来自 ${orphanLogIds.length} 个已删除的日志）：\n\n`;
        for (const logId of orphanLogIds) {
            const items = orphansByLogId[logId];
            const preview = items[0]?.content?.substring(0, 50) || '(无内容)';
            report += `• ${logId}：${items.length} 条向量\n  预览: ${preview}...\n`;
        }
        report += `\n确定要删除这 ${orphans.length} 条孤儿向量吗？`;

        if (!confirm(report)) {
            if (statusEl) statusEl.textContent = `发现 ${orphans.length} 条孤儿向量，用户取消清理。`;
            return;
        }

        // 5. 按 log_id 批量删除
        if (statusEl) statusEl.textContent = '正在清理...';
        let deletedTotal = 0;
        for (const logId of orphanLogIds) {
            const count = await mlabDeleteVectorsByLogId(logId);
            deletedTotal += count;
        }

        if (statusEl) statusEl.innerHTML = `✅ 清理完成！已删除 ${deletedTotal} 条孤儿向量。`;
        console.log(`Memory Lab: 孤儿向量清理完成，删除 ${deletedTotal} 条`);

    } catch(err) {
        console.error('Memory Lab: 孤儿向量扫描失败', err);
        if (statusEl) statusEl.textContent = '扫描失败: ' + err.message;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '扫描孤儿向量（清理历史残留）'; }
    }
}

async function mlabScanGaps() {
    if (mlabHistoryRunning) { alert('正在提取中，请等待完成'); return; }
    if (!mlabConfig.model) { alert('请先在"配置"页选择总结模型'); return; }
    if (!mlabConfig.prompt || mlabConfig.prompt.trim().length < 10) { alert('请先填写提取提示词'); return; }

    const [providerId, modelId] = mlabConfig.model.split('||');
    const provider = appData.providers.find(p => p.id === providerId);
    if (!provider) { alert('供应商未找到'); return; }

    await initWechatData();
    const conversations = wechatData?.conversations;
    if (!conversations) { alert('没有微信对话数据'); return; }

    const statusEl = document.getElementById('mlabGapStatus');
    const btn = document.getElementById('mlabGapBtn');

    // 收集所有开了向量记忆的助手
    const targets = [];
    for (const assistantId of Object.keys(conversations)) {
        const assistant = appData.assistants.find(a => a.id === assistantId);
        if (!assistant || !assistant.vectorMemoryEnabled) continue;
        const conv = conversations[assistantId];
        if (!conv || !conv.messages || conv.messages.length < 2) continue;
        targets.push({ assistantId, assistant, messages: conv.messages });
    }
    if (targets.length === 0) { alert('没有开启向量记忆的助手'); return; }

    // 1. 扫描缺口
    statusEl.textContent = '正在扫描缺口...';
    let allGaps = [];

    for (const target of targets) {
        const { assistantId, assistant, messages } = target;

        // 收集该助手的所有日志覆盖范围
        const coveredRanges = [];
        for (const log of mlabLogs) {
            if (log.assistantId !== assistantId || !log.timeRange) continue;
            const startTime = new Date(log.timeRange.start).getTime();
            const endTime = new Date(log.timeRange.end).getTime();
            // 找对应的消息索引
            let startIdx = -1, endIdx = -1;
            for (let i = 0; i < messages.length; i++) {
                const t = new Date(messages[i].timestamp).getTime();
                if (startIdx === -1 && t >= startTime) startIdx = i;
                if (t <= endTime) endIdx = i;
            }
            if (startIdx >= 0 && endIdx >= 0) {
                coveredRanges.push({ start: startIdx, end: endIdx });
            }
        }

        if (coveredRanges.length === 0) continue;

        // 排序并合并重叠范围
        coveredRanges.sort((a, b) => a.start - b.start);
        const merged = [coveredRanges[0]];
        for (let i = 1; i < coveredRanges.length; i++) {
            const last = merged[merged.length - 1];
            if (coveredRanges[i].start <= last.end + 1) {
                last.end = Math.max(last.end, coveredRanges[i].end);
            } else {
                merged.push({ ...coveredRanges[i] });
            }
        }

        // 找缺口（在已覆盖的最小~最大范围之间）
        const minCovered = merged[0].start;
        const maxCovered = merged[merged.length - 1].end;
        const progress = mlabExtractProgress[assistantId] || 0;
        const scanEnd = Math.max(maxCovered, progress);

        for (let i = 0; i < merged.length - 1; i++) {
            const gapStart = merged[i].end + 1;
            const gapEnd = merged[i + 1].start - 1;
            if (gapEnd >= gapStart) {
                allGaps.push({
                    assistantId,
                    assistant,
                    messages,
                    startIdx: gapStart,
                    endIdx: gapEnd,
                    count: gapEnd - gapStart + 1
                });
            }
        }

        // 检查最后一个覆盖范围到进度之间的缺口
        if (scanEnd > maxCovered + 1) {
            allGaps.push({
                assistantId,
                assistant,
                messages,
                startIdx: maxCovered + 1,
                endIdx: scanEnd,
                count: scanEnd - maxCovered
            });
        }
    }

    if (allGaps.length === 0) {
        statusEl.innerHTML = '<span style="color:#059669;">✓ 未发现缺口，所有消息都已覆盖</span>';
        return;
    }

    // 显示缺口统计
    const totalMissing = allGaps.reduce((s, g) => s + g.count, 0);
    const gapSummary = allGaps.map(g => `#${g.startIdx}~${g.endIdx} (${g.count}条)`).join('\n');

    if (!confirm(`发现 ${allGaps.length} 个缺口，共 ${totalMissing} 条消息未提取：\n\n${gapSummary.substring(0, 500)}${gapSummary.length > 500 ? '\n...' : ''}\n\n开始补提取？`)) {
        statusEl.textContent = `发现 ${allGaps.length} 个缺口，${totalMissing} 条消息，已取消`;
        return;
    }

    // 2. 逐个补提取
    mlabHistoryRunning = true;
    mlabHistoryAbort = false;
    btn.disabled = true;
    btn.textContent = '补提取中...';

    let successCount = 0;
    let failCount = 0;

    for (let g = 0; g < allGaps.length; g++) {
        if (mlabHistoryAbort) break;
        const gap = allGaps[g];
        const gapMessages = gap.messages.slice(gap.startIdx, gap.endIdx + 1);
        if (gapMessages.length === 0) continue;

        const assistantName = gap.assistant.name || '助手';
        const userName = appData.settings.userName || '用户';

        statusEl.textContent = `补提取 ${g + 1}/${allGaps.length}: #${gap.startIdx}~${gap.endIdx} (${gap.count}条)...`;

        // 切分（用沉默超时模式，按30分钟切）
        let chunks = mlabPreSplit(gapMessages);
        // 如果切分后为空但消息数 > 0，整批处理
        if (chunks.length === 0 && gapMessages.length > 0) {
            chunks = [gapMessages];
        }

        for (let i = 0; i < chunks.length; i++) {
            if (mlabHistoryAbort) break;
            const chunk = chunks[i];

            try {
                const { narratives, rawContent } = await mlabExtractChunk(chunk, assistantName, userName, provider, modelId);
                const logId = 'mlog_gap_' + Date.now() + '_' + g + '_' + i;

                if (narratives) {
                    mlabSaveLog({
                        id: logId,
                        assistantId: gap.assistantId,
                        assistantName,
                        triggerTime: new Date().toISOString(),
                        triggerReason: '补漏提取',
                        chunkSize: chunk.length,
                        timeRange: { start: chunk[0].timestamp, end: chunk[chunk.length - 1].timestamp },
                        inputMessages: chunk,
                        outputNarratives: narratives,
                        rawOutput: rawContent,
                        status: 'success'
                    });
                    if (mlabConfig.siliconFlowKey && cloudSyncEnabled()) {
                        await mlabBatchStoreVectors(narratives, gap.assistantId, logId, chunk[0].timestamp, chunk[chunk.length - 1].timestamp);
                    }
                    successCount++;
                } else {
                    mlabSaveLog({
                        id: logId,
                        assistantId: gap.assistantId,
                        assistantName,
                        triggerTime: new Date().toISOString(),
                        triggerReason: '补漏提取',
                        chunkSize: chunk.length,
                        timeRange: { start: chunk[0].timestamp, end: chunk[chunk.length - 1].timestamp },
                        inputMessages: chunk,
                        outputNarratives: [],
                        rawOutput: rawContent,
                        status: 'parse_error',
                        error: 'JSON 解析失败'
                    });
                    failCount++;
                }
            } catch(err) {
                console.error(`Memory Lab 补漏: 缺口${g + 1} chunk${i} 失败`, err);
                failCount++;
                statusEl.textContent = `缺口${g + 1} chunk${i} 出错: ${err.message}，3秒后继续...`;
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }

    mlabHistoryRunning = false;
    btn.disabled = false;
    btn.textContent = '扫描补漏（检测并补提取缺口）';
    statusEl.innerHTML = `<span style="color:#059669;">补漏完成！成功 ${successCount} 块${failCount > 0 ? '，失败 ' + failCount + ' 块' : ''}</span>`;
    mlabRenderLogPanel();
}

async function mlabStartHistoryExtract() {
    if (mlabHistoryRunning) return;
    if (!mlabConfig.model) { alert('请先在"配置"页选择总结模型'); return; }
    if (!mlabConfig.prompt || mlabConfig.prompt.trim().length < 10) { alert('请先填写提取提示词'); return; }

    const [providerId, modelId] = mlabConfig.model.split('||');
    const provider = appData.providers.find(p => p.id === providerId);
    if (!provider) { alert('供应商未找到'); return; }

    // 确保 wechatData 已加载（从主屏直接进 Memory Lab 时可能还没初始化）
    await initWechatData();
    const conversations = wechatData?.conversations;
    if (!conversations) { alert('没有微信对话数据'); return; }

    // 收集所有开了向量记忆的助手
    const targets = [];
    for (const assistantId of Object.keys(conversations)) {
        const assistant = appData.assistants.find(a => a.id === assistantId);
        if (!assistant || !assistant.vectorMemoryEnabled) continue;
        const conv = conversations[assistantId];
        if (!conv || !conv.messages || conv.messages.length < 2) continue;
        targets.push({ assistantId, assistant, messages: conv.messages });
    }
    if (targets.length === 0) { alert('没有开启向量记忆的助手，或没有对话数据'); return; }

    mlabHistoryRunning = true;
    mlabHistoryAbort = false;
    const btn = document.getElementById('mlabHistoryBtn');
    const stopBtn = document.getElementById('mlabHistoryStopBtn');
    const statusEl = document.getElementById('mlabHistoryStatus');
    btn.disabled = true;
    btn.textContent = '提取中...';
    stopBtn.style.display = 'block';

    try {
        for (const target of targets) {
            if (mlabHistoryAbort) break;
            const { assistantId, assistant, messages } = target;
            const assistantName = assistant.name || '助手';
            const userName = appData.settings.userName || '用户';

            statusEl.textContent = `[${assistantName}] 正在切分 ${messages.length} 条消息...`;
            const chunks = mlabPreSplit(messages);
            if (chunks.length === 0) {
                statusEl.textContent = `[${assistantName}] 消息不足最小门槛，跳过`;
                continue;
            }

            console.log(`Memory Lab 历史提取: [${assistantName}] ${messages.length} 条消息 → ${chunks.length} 个块`);

            for (let i = 0; i < chunks.length; i++) {
                if (mlabHistoryAbort) break;
                statusEl.textContent = `[${assistantName}] 正在提取第 ${i + 1}/${chunks.length} 块 (${chunks[i].length}条)...`;

                try {
                    const chunk = chunks[i];
                    const { narratives, rawContent } = await mlabExtractChunk(chunk, assistantName, userName, provider, modelId);
                    const logId = 'mlog_hist_' + Date.now() + '_' + i;

                    if (narratives) {
                        mlabSaveLog({
                            id: logId,
                            assistantId,
                            assistantName,
                            triggerTime: new Date().toISOString(),
                            triggerReason: '历史数据提取',
                            chunkSize: chunk.length,
                            timeRange: { start: chunk[0].timestamp, end: chunk[chunk.length - 1].timestamp },
                            inputMessages: chunk,
                            outputNarratives: narratives,
                            rawOutput: rawContent,
                            status: 'success'
                        });
                        // 存入向量库
                        if (mlabConfig.siliconFlowKey && cloudSyncEnabled()) {
                            statusEl.textContent = `[${assistantName}] 第 ${i + 1}/${chunks.length} 块：存入向量库 (${narratives.length}条叙事元)...`;
                            await mlabBatchStoreVectors(narratives, assistantId, logId, chunk[0].timestamp, chunk[chunk.length - 1].timestamp);
                        }
                        console.log(`Memory Lab 历史提取: [${assistantName}] 块${i + 1}/${chunks.length} 成功，${narratives.length}条叙事元`);
                    } else {
                        mlabSaveLog({
                            id: logId, assistantId, assistantName,
                            triggerTime: new Date().toISOString(),
                            triggerReason: '历史数据提取',
                            chunkSize: chunk.length,
                            timeRange: { start: chunk[0].timestamp, end: chunk[chunk.length - 1].timestamp },
                            inputMessages: chunk, outputNarratives: [], rawOutput: rawContent,
                            status: 'parse_error', error: 'JSON 解析失败'
                        });
                        console.warn(`Memory Lab 历史提取: [${assistantName}] 块${i + 1} JSON解析失败`);
                    }
                } catch(e) {
                    console.error(`Memory Lab 历史提取: 块${i + 1} 出错`, e);
                    statusEl.textContent = `[${assistantName}] 第 ${i + 1} 块出错: ${e.message}，3秒后继续...`;
                    await new Promise(r => setTimeout(r, 3000));
                }

                // 块间间隔，避免 API 限流
                if (i < chunks.length - 1 && !mlabHistoryAbort) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            // 提取完，更新进度到末尾
            if (!mlabHistoryAbort) {
                mlabExtractProgress[assistantId] = messages.length - 1;
                saveMlabProgress();
            }
        }

        statusEl.textContent = mlabHistoryAbort ? '已暂停' : '全部提取完成！';
        statusEl.style.color = mlabHistoryAbort ? '#d97706' : '#16a34a';
    } catch(e) {
        statusEl.textContent = `出错: ${e.message}`;
        statusEl.style.color = '#ef4444';
        console.error('Memory Lab 历史提取失败:', e);
    } finally {
        mlabHistoryRunning = false;
        btn.disabled = false;
        btn.textContent = '提取历史数据';
        stopBtn.style.display = 'none';
    }
}

function mlabStopHistoryExtract() {
    mlabHistoryAbort = true;
    document.getElementById('mlabHistoryStopBtn').textContent = '正在停止...';
}

// ==================== Memory Lab 结束 ====================
