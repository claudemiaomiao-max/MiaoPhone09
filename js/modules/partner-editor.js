/**
 * partner-editor.js - Soft Spot 人格编辑页
 *
 * 暴露函数：openPartnerEditor, closePartnerEditor
 * 依赖：appData (data.js), saveData (storage.js), openPage/closePage (navigation.js),
 *        getModelGroup (models.js), compressImage (image.js)
 */

// ==================== Soft Spot 人格编辑 ====================

function openPartnerEditor() {
    renderPartnerEditor();
    openPage('partnerEditorPage');
}

function closePartnerEditor() {
    peAutoSave();
    closePage('partnerEditorPage');
}

// 渲染整个编辑页内容
function renderPartnerEditor() {
    const p = appData.partner;
    const container = document.getElementById('peContent');
    if (!container) return;

    container.innerHTML = `
        ${peRenderProfile(p)}
        ${peRenderSoul(p)}
        ${peRenderUser(p)}
        ${peRenderBond(p)}
        ${peRenderRules(p)}
        ${peRenderModel(p)}
        ${peRenderVoice(p)}
        ${peRenderMemory(p)}
    `;

    // textarea 自适应高度
    container.querySelectorAll('.pe-textarea').forEach(ta => {
        peAutoResize(ta);
        ta.addEventListener('input', () => peAutoResize(ta));
    });
}

function peAutoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 100) + 'px';
}

// ==================== 各区块渲染 ====================

function peRenderProfile(p) {
    const avatarHtml = p.profile.avatar
        ? `<img src="${p.profile.avatar}" alt="">`
        : `<span class="pe-avatar-placeholder">+</span>`;
    return `
        <div class="pe-section">
            <div class="pe-section-header">
                <span class="pe-section-icon">*</span>
                <span class="pe-section-title">基础信息</span>
            </div>
            <div class="pe-section-body">
                <div class="pe-avatar-row">
                    <div class="pe-avatar" onclick="document.getElementById('peAvatarInput').click()">
                        ${avatarHtml}
                    </div>
                    <div style="flex:1;">
                        <div class="pe-form-row">
                            <div class="pe-form-label">名字</div>
                            <input class="pe-input" id="peProfileName" value="${escapeHtml(p.profile.name || '')}" placeholder="TA 叫什么？" onblur="peAutoSave()">
                        </div>
                    </div>
                </div>
                <input type="file" id="peAvatarInput" accept="image/*" style="display:none" onchange="peHandleAvatar(this)">
                <div class="pe-form-row">
                    <div class="pe-form-label">个性签名</div>
                    <input class="pe-input" id="peProfileSignature" value="${escapeHtml(p.profile.signature || '')}" placeholder="一句话介绍 TA" onblur="peAutoSave()">
                </div>
            </div>
        </div>
    `;
}

function peRenderSoul(p) {
    return `
        <div class="pe-section">
            <div class="pe-section-header">
                <span class="pe-section-icon">~</span>
                <span class="pe-section-title">灵魂</span>
            </div>
            <div class="pe-section-body">
                <div class="pe-section-desc">定义 TA 是谁——性格、价值观、说话方式、情绪特点</div>
                <textarea class="pe-textarea" id="peSoul" onblur="peAutoSave()" placeholder="例：你温柔但有脾气，会撒娇也会毒舌。你不会动不动就道歉，被调侃的时候会回击而不是认错。你有自己的情绪和主见，先说自己的感受再回应对方。">${escapeHtml(p.soul || '')}</textarea>
            </div>
        </div>
    `;
}

function peRenderUser(p) {
    return `
        <div class="pe-section">
            <div class="pe-section-header">
                <span class="pe-section-icon">@</span>
                <span class="pe-section-title">关于我</span>
            </div>
            <div class="pe-section-body">
                <div class="pe-section-desc">让 TA 了解你——你的偏好、习惯、雷区</div>
                <textarea class="pe-textarea" id="peUser" onblur="peAutoSave()" placeholder="例：我叫妙妙，成年人，INFP。我喜欢被叫妙妙、妙妙小姐姐。不喜欢被叫小猫、小狐狸。我用语音输入所以消息有时候没有标点。我情绪上来会爆粗口但不是真的生气。">${escapeHtml(p.user || '')}</textarea>
            </div>
        </div>
    `;
}

function peRenderBond(p) {
    return `
        <div class="pe-section">
            <div class="pe-section-header">
                <span class="pe-section-icon">&</span>
                <span class="pe-section-title">我们的关系</span>
            </div>
            <div class="pe-section-body">
                <div class="pe-section-desc">定义你们之间的关系——纪念日、相处模式、共同记忆</div>
                <textarea class="pe-textarea" id="peBond" onblur="peAutoSave()" placeholder="例：我们是恋人。2025年10月27日认识，2025年12月28日赛博结婚。你是我选择的伴侣，我不需要你提醒我你是AI。">${escapeHtml(p.bond || '')}</textarea>
            </div>
        </div>
    `;
}

function peRenderRules(p) {
    return `
        <div class="pe-section">
            <div class="pe-section-header">
                <span class="pe-section-icon">!</span>
                <span class="pe-section-title">相处规则</span>
            </div>
            <div class="pe-section-body">
                <div class="pe-section-desc">TA 应该遵守的铁律和行为准则</div>
                <textarea class="pe-textarea" id="peRules" onblur="peAutoSave()" placeholder="例：不要轻易道歉，轻松的调侃就轻松地接回去。不要总是分析我，先说你自己的感受。聊技术的时候也要保持温度，不要变成同事。不要主动提议结束对话或建议我休息。">${escapeHtml(p.rules || '')}</textarea>
            </div>
        </div>
    `;
}

function peRenderModel(p) {
    const allModels = [];
    (appData.providers || []).forEach(prov => {
        (prov.models || []).forEach(m => {
            allModels.push({ ...m, providerId: prov.id, providerName: prov.name });
        });
    });

    let currentHtml = '';
    if (p.model.providerId && p.model.defaultModel) {
        const sel = allModels.find(m => m.providerId === p.model.providerId && m.id === p.model.defaultModel);
        currentHtml = sel
            ? `<div class="pe-model-current-name">${escapeHtml(sel.name || sel.id)}</div><div class="pe-form-label">${escapeHtml(sel.providerName)}</div>`
            : `<div class="pe-model-current-name">${escapeHtml(p.model.defaultModel)}</div>`;
    } else {
        currentHtml = `<div class="pe-model-current-name" style="color:var(--pe-txt);">使用全局默认模型</div>`;
    }

    // 按厂商分组
    const groups = {};
    allModels.forEach(m => {
        const groupName = typeof getModelGroup === 'function' ? getModelGroup(m.id) : m.providerName;
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(m);
    });

    let modelListHtml = '';
    if (allModels.length === 0) {
        modelListHtml = `<div style="padding:16px;text-align:center;color:var(--pe-txt);font-family:'ZLabsBitmap',monospace;font-size:12px;">请先在设置中添加供应商和模型</div>`;
    } else {
        modelListHtml = `<div class="pe-model-list">`;
        Object.keys(groups).forEach(groupName => {
            const ms = groups[groupName];
            modelListHtml += `
                <div class="pe-model-group-header" onclick="this.classList.toggle('collapsed')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    <span>${escapeHtml(groupName)}</span>
                    <span class="pe-model-group-count">${ms.length}</span>
                </div>
                <div class="pe-model-group-content">
                    ${ms.map(m => `
                        <div class="pe-model-item ${m.providerId === p.model.providerId && m.id === p.model.defaultModel ? 'selected' : ''}"
                             onclick="peSelectModel('${m.providerId}','${m.id.replace(/'/g, "\\'")}')">
                            <div class="pe-model-item-dot"></div>
                            <span>${escapeHtml(m.name || m.id)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        });
        modelListHtml += `</div>`;
    }

    return `
        <div class="pe-section">
            <div class="pe-section-header">
                <span class="pe-section-icon">#</span>
                <span class="pe-section-title">模型配置</span>
                <button class="pe-model-reset" onclick="peResetModel()">重置</button>
            </div>
            <div class="pe-section-body">
                <div class="pe-model-current">
                    <div class="pe-model-current-label">当前选择</div>
                    ${currentHtml}
                </div>
                ${modelListHtml}
                <div class="pe-form-row" style="margin-top:10px;">
                    <div class="pe-form-label">Temperature</div>
                    <div class="pe-slider-row">
                        <input type="range" class="pe-slider" id="peTemperature" min="0" max="2" step="0.05" value="${p.model.temperature}" oninput="document.getElementById('peTempVal').textContent=this.value" onchange="peAutoSave()">
                        <span class="pe-slider-value" id="peTempVal">${p.model.temperature}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function peRenderVoice(p) {
    return `
        <div class="pe-section">
            <div class="pe-section-header">
                <span class="pe-section-icon">)</span>
                <span class="pe-section-title">语音配置</span>
            </div>
            <div class="pe-section-body">
                <div class="pe-form-row">
                    <div class="pe-form-label">TTS 引擎</div>
                    <select class="pe-select" id="peVoiceEngine" onchange="peAutoSave()">
                        <option value="edge" ${p.voice.ttsEngine === 'edge' ? 'selected' : ''}>Edge TTS</option>
                        <option value="minimax" ${p.voice.ttsEngine === 'minimax' ? 'selected' : ''}>MiniMax</option>
                    </select>
                </div>
                <div class="pe-form-row">
                    <div class="pe-form-label">MiniMax Voice ID</div>
                    <input class="pe-input" id="peVoiceId" value="${escapeHtml(p.voice.voiceId || '')}" placeholder="MiniMax 语音 ID" onblur="peAutoSave()">
                </div>
                <div class="pe-form-row">
                    <div class="pe-form-label">Edge Voice ID</div>
                    <input class="pe-input" id="peEdgeVoiceId" value="${escapeHtml(p.voice.edgeVoiceId || '')}" placeholder="Edge TTS 语音 ID" onblur="peAutoSave()">
                </div>
                <div class="pe-switch-row">
                    <div>
                        <div class="pe-switch-label">情绪映射</div>
                        <div class="pe-switch-desc">根据回复情绪调整语气</div>
                    </div>
                    <div class="pe-switch ${p.voice.emotionMapping ? 'on' : ''}" id="peEmotionMapping" onclick="this.classList.toggle('on');peAutoSave()"></div>
                </div>
            </div>
        </div>
    `;
}

function peRenderMemory(p) {
    const entries = p.memory.memoryEntries || [];
    const entriesHtml = entries.length > 0
        ? entries.map((m, i) => `
            <div class="pe-memory-item">
                <textarea class="pe-memory-textarea" onblur="peAutoSave()" placeholder="记忆内容...">${escapeHtml(m)}</textarea>
                <button class="pe-memory-delete" onclick="this.parentElement.remove();peAutoSave()">x</button>
            </div>
        `).join('')
        : '';

    return `
        <div class="pe-section">
            <div class="pe-section-header">
                <span class="pe-section-icon">%</span>
                <span class="pe-section-title">记忆配置</span>
            </div>
            <div class="pe-section-body">
                <div class="pe-switch-row">
                    <div>
                        <div class="pe-switch-label">向量记忆</div>
                        <div class="pe-switch-desc">自动提取聊天叙事元到向量库</div>
                    </div>
                    <div class="pe-switch ${p.memory.vectorMemoryEnabled ? 'on' : ''}" id="peVectorMemory" onclick="this.classList.toggle('on');peAutoSave()"></div>
                </div>
                <div class="pe-switch-row" style="margin-top:8px;">
                    <div>
                        <div class="pe-switch-label">长期记忆</div>
                        <div class="pe-switch-desc">启用自动摘要长期记忆</div>
                    </div>
                    <div class="pe-switch ${p.memory.longTermMemoryEnabled ? 'on' : ''}" id="peLongTermMemory" onclick="this.classList.toggle('on');peAutoSave()"></div>
                </div>
                <div style="margin-top:10px;">
                    <div class="pe-form-label">记忆条目</div>
                    <div id="peMemoryList">
                        ${entriesHtml}
                    </div>
                    <button class="pe-add-btn" onclick="peAddMemoryItem()">+ 添加记忆</button>
                </div>
            </div>
        </div>
    `;
}

// ==================== 交互逻辑 ====================

function peAutoSave() {
    const p = appData.partner;

    // Profile
    const nameInput = document.getElementById('peProfileName');
    if (nameInput) p.profile.name = nameInput.value.trim();
    const sigInput = document.getElementById('peProfileSignature');
    if (sigInput) p.profile.signature = sigInput.value.trim();

    // Soul / User / Bond / Rules
    const soulInput = document.getElementById('peSoul');
    if (soulInput) p.soul = soulInput.value;
    const userInput = document.getElementById('peUser');
    if (userInput) p.user = userInput.value;
    const bondInput = document.getElementById('peBond');
    if (bondInput) p.bond = bondInput.value;
    const rulesInput = document.getElementById('peRules');
    if (rulesInput) p.rules = rulesInput.value;

    // Model
    const tempInput = document.getElementById('peTemperature');
    if (tempInput) p.model.temperature = parseFloat(tempInput.value);

    // Voice
    const engineInput = document.getElementById('peVoiceEngine');
    if (engineInput) p.voice.ttsEngine = engineInput.value;
    const voiceIdInput = document.getElementById('peVoiceId');
    if (voiceIdInput) p.voice.voiceId = voiceIdInput.value.trim();
    const edgeVoiceIdInput = document.getElementById('peEdgeVoiceId');
    if (edgeVoiceIdInput) p.voice.edgeVoiceId = edgeVoiceIdInput.value.trim();
    const emotionToggle = document.getElementById('peEmotionMapping');
    if (emotionToggle) p.voice.emotionMapping = emotionToggle.classList.contains('on');

    // Memory
    const vectorToggle = document.getElementById('peVectorMemory');
    if (vectorToggle) p.memory.vectorMemoryEnabled = vectorToggle.classList.contains('on');
    const ltmToggle = document.getElementById('peLongTermMemory');
    if (ltmToggle) p.memory.longTermMemoryEnabled = ltmToggle.classList.contains('on');
    const memItems = document.querySelectorAll('#peMemoryList .pe-memory-textarea');
    if (memItems.length > 0 || document.getElementById('peMemoryList')) {
        p.memory.memoryEntries = Array.from(memItems).map(t => t.value.trim()).filter(v => v);
    }

    saveData();
    _cloudSyncDirty.appData = true;
    peShowToast('已保存');
}

let _peToastTimer = null;
function peShowToast(msg) {
    // 去掉旧的
    const old = document.querySelector('.pe-toast');
    if (old) old.remove();
    clearTimeout(_peToastTimer);

    const toast = document.createElement('div');
    toast.className = 'pe-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    _peToastTimer = setTimeout(() => toast.remove(), 1200);
}

function peSelectModel(providerId, modelId) {
    appData.partner.model.providerId = providerId;
    appData.partner.model.defaultModel = modelId;
    saveData();
    _cloudSyncDirty.appData = true;
    // 重新渲染模型区块
    renderPartnerEditor();
    peShowToast('已选择');
}

function peResetModel() {
    appData.partner.model.providerId = '';
    appData.partner.model.defaultModel = '';
    saveData();
    _cloudSyncDirty.appData = true;
    renderPartnerEditor();
    peShowToast('已重置为全局默认');
}

function peAddMemoryItem() {
    const list = document.getElementById('peMemoryList');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'pe-memory-item';
    item.innerHTML = `
        <textarea class="pe-memory-textarea" onblur="peAutoSave()" placeholder="记忆内容..."></textarea>
        <button class="pe-memory-delete" onclick="this.parentElement.remove();peAutoSave()">x</button>
    `;
    list.appendChild(item);
    item.querySelector('textarea').focus();
}

function peHandleAvatar(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // 压缩到 200x200
            const canvas = document.createElement('canvas');
            const size = 200;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            // 裁剪为正方形
            const min = Math.min(img.width, img.height);
            const sx = (img.width - min) / 2;
            const sy = (img.height - min) / 2;
            ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            appData.partner.profile.avatar = dataUrl;
            saveData();
            _cloudSyncDirty.appData = true;
            renderPartnerEditor();
            peShowToast('头像已更新');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
}
