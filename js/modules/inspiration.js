/**
 * 碎碎念模块
 * 负责：碎碎念数据管理、标签过滤、保存/编辑/删除、导出、语音输入
 * 暴露函数：loadInspirationData, saveInspirationData, openInspirationPage,
 *          wechatSaveToInspiration, renderInspirationList, startInspirationVoiceInput
 * 依赖：saveToIndexedDB/loadFromIndexedDB(storage.js), openPage/closePage(navigation.js),
 *       escapeHtml(ui.js), showWechatToast(ui.js), startVoiceInputCommon/stopVoiceInputCommon(stt.js)
 */

// ==================== 碎碎念 ====================
let inspirationData = {
    items: [],
    lastSyncTime: null
};
let _inspirationDataLoaded = false;
let inspCurrentFilter = 'all';
let _inspSaveModalMsgId = null;
let _inspSaveModalAssistantId = null;

// 标签配置
const INSP_TAGS = {
    todo: { label: 'TODO', color: '#3b82f6' },
    clip: { label: 'Clip', color: '#22c55e' },
    idea: { label: '灵感', color: '#f59e0b' },
    bug: { label: 'BUG', color: '#ef4444' },
    chen: { label: '嗔嗔', color: '#c084fc' },
    link_tutorial: { label: '教程', color: '#0ea5e9' },
    link_resource: { label: '素材', color: '#f97316' },
    link_tool: { label: '工具', color: '#14b8a6' },
    link_beauty: { label: '美化', color: '#e879f9' },
    link_inspo: { label: '灵感参考', color: '#ec4899' },
    murmur: { label: 'Murmur', color: '#e8a0b8' }
};
const LINK_TAGS = ['link_tutorial', 'link_resource', 'link_tool', 'link_beauty', 'link_inspo'];
const TEXT_TAGS = ['todo', 'clip', 'idea', 'bug', 'chen'];

// 加载碎碎念数据
async function loadInspirationData() {
    if (dbInstance) {
        const data = await loadFromIndexedDB('inspirationData');
        if (data) {
            inspirationData = { ...inspirationData, ...data };
            _inspirationDataLoaded = true;
            return;
        }
    }
    // 降级 localStorage
    try {
        const saved = localStorage.getItem('miaomiao_inspiration_v1');
        if (saved) inspirationData = { ...inspirationData, ...JSON.parse(saved) };
    } catch (e) {
        console.error('加载碎碎念数据失败:', e);
    }
    _inspirationDataLoaded = true;
}

// 保存碎碎念数据
function saveInspirationData() {
    if (!_inspirationDataLoaded) {
        console.warn('碎碎念数据尚未加载完成，跳过保存以防覆盖');
        return;
    }
    if (dbInstance) {
        saveToIndexedDB('inspirationData', inspirationData).then(success => {
            if (!success) {
                localStorage.setItem('miaomiao_inspiration_v1', JSON.stringify(inspirationData));
            }
        });
        _cloudSyncDirty.inspirationData = true;
        return;
    }
    try {
        localStorage.setItem('miaomiao_inspiration_v1', JSON.stringify(inspirationData));
    } catch (e) {
        console.error('保存碎碎念数据失败:', e);
    }
    _cloudSyncDirty.inspirationData = true;
}

// 打开碎碎念页面
async function openInspirationPage() {
    await loadInspirationData();
    openPage('inspirationPage');
    renderInspirationList();
}

// 关闭碎碎念页面
function closeInspirationPage() {
    // 停止语音输入（如果正在录音）
    if (voiceInputTarget === 'inspiration' && voiceRecognition) {
        stopVoiceInputCommon();
    }
    closePage('inspirationPage');
}

// 搜索切换
function toggleInspSearch() {
    const bar = document.getElementById('inspSearchBar');
    const input = document.getElementById('inspSearchInput');
    if (bar.classList.contains('show')) {
        bar.classList.remove('show');
        input.value = '';
        renderInspirationList();
    } else {
        bar.classList.add('show');
        input.focus();
    }
}

// 筛选切换
let inspLinkSubFilter = 'all';
function setInspFilter(tag) {
    inspCurrentFilter = tag;
    inspLinkSubFilter = 'all';
    // 更新 tab 样式
    document.querySelectorAll('#inspTabs .insp-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    // 显示/隐藏链接子标签
    const subtabs = document.getElementById('inspLinkSubtabs');
    if (tag === 'link') {
        subtabs.style.display = 'flex';
        document.querySelectorAll('.insp-subtab').forEach(t => t.classList.remove('active'));
        subtabs.querySelector('.insp-subtab').classList.add('active');
    } else {
        subtabs.style.display = 'none';
    }
    renderInspirationList();
}

function setInspLinkSubFilter(subtag) {
    inspLinkSubFilter = subtag;
    document.querySelectorAll('.insp-subtab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    renderInspirationList();
}

// URL 输入框切换
function toggleInspUrl() {
    const row = document.getElementById('inspUrlRow');
    row.classList.toggle('show');
    if (row.classList.contains('show')) {
        document.getElementById('inspUrlInput').focus();
    }
}

// 从文本中提取URL
function extractUrlFromText(text) {
    const urlRegex = /(https?:\/\/[^\s，。！？、\u201c\u201d\u2018\u2019]+)/gi;
    const match = text.match(urlRegex);
    if (!match) return { content: text, url: '' };
    const url = match[0];
    const content = text.replace(url, '').replace(/\s+/g, ' ').trim();
    return { content, url };
}

// 检测输入内容是否包含链接，动态切换标签行
let _inspTagHideTimer = null;

function showInspTagRow() {
    clearTimeout(_inspTagHideTimer);
    const tagRow = document.getElementById('inspTagRow');
    tagRow.style.display = 'flex';
    checkInspInputForUrl();
}

function hideInspTagRowDelay() {
    // 延迟隐藏，给点击标签按钮留时间
    _inspTagHideTimer = setTimeout(() => {
        const tagRow = document.getElementById('inspTagRow');
        const input = document.getElementById('inspirationInput');
        // 如果输入框有内容就保持显示
        if (input && input.value.trim()) return;
        tagRow.style.display = 'none';
    }, 200);
}

function checkInspInputForUrl() {
    const input = document.getElementById('inspirationInput');
    const text = input.value || '';
    const hasUrl = /(https?:\/\/[^\s]+)/i.test(text);
    const tagRow = document.getElementById('inspTagRow');
    if (hasUrl) {
        tagRow.innerHTML = LINK_TAGS.map(t =>
            `<button class="insp-tag-btn ${t}" onclick="saveInspiration('${t}')">${INSP_TAGS[t].label}</button>`
        ).join('');
    } else {
        tagRow.innerHTML = TEXT_TAGS.map(t =>
            `<button class="insp-tag-btn ${t}" onclick="saveInspiration('${t}')">${INSP_TAGS[t].label}</button>`
        ).join('');
    }
}

// 快速发送（爱心按钮）：一律存为 murmur
function quickSaveInspiration() {
    saveInspiration('murmur');
}

// 存灵感（独立入口）
function saveInspiration(tag) {
    const input = document.getElementById('inspirationInput');
    const rawContent = input.value.trim();
    if (!rawContent) {
        showWechatToast('写点什么再存哦~', 'info');
        return;
    }
    const urlInput = document.getElementById('inspUrlInput');
    const manualUrl = urlInput ? urlInput.value.trim() : '';

    // 如果手动填了链接就用手动的，否则自动从文本提取
    let content = rawContent;
    let url = manualUrl;
    if (!manualUrl) {
        const extracted = extractUrlFromText(rawContent);
        content = extracted.content;
        url = extracted.url;
    }

    addInspirationItem(content, tag, url, 'external', null, null);

    // 清空
    input.value = '';
    input.style.height = 'auto';
    if (urlInput) urlInput.value = '';
    document.getElementById('inspUrlRow').classList.remove('show');
    document.getElementById('inspTagRow').style.display = 'none';

    showWechatToast(`已存 ${INSP_TAGS[tag]?.label || tag} 💭`, 'success');
    renderInspirationList();
}

// 微信长按 → 存碎碎念
function wechatSaveToInspiration() {
    closeWechatContextMenu();
    if (!wechatSelectedMsgId) return;
    const conv = wechatData.conversations[wechatData.currentAssistantId];
    let msg = conv?.messages?.find(m => m.id === wechatSelectedMsgId);
    if (!msg) msg = wechatData.pendingMessages.find(m => m.id === wechatSelectedMsgId);
    if (!msg) return;

    const text = msg.type === 'voice_message' ? stripInterjectionsAlways(msg.content) : (msg.content || '');
    _inspSaveModalMsgId = msg.id;
    _inspSaveModalAssistantId = wechatData.currentAssistantId;
    showInspSaveModal(text);
}

// 显示存灵感浮层
function showInspSaveModal(text) {
    const textarea = document.getElementById('inspSaveModalText');
    textarea.value = text || '';
    document.getElementById('inspSaveModal').classList.add('show');
    setTimeout(() => textarea.focus(), 300);
}

// 关闭浮层
function closeInspSaveModal() {
    document.getElementById('inspSaveModal').classList.remove('show');
    _inspSaveModalMsgId = null;
    _inspSaveModalAssistantId = null;
    // 如果是编辑模式，恢复按钮原始行为
    const modal = document.getElementById('inspSaveModal');
    const tagRow = modal.querySelector('.insp-tag-row');
    if (tagRow && tagRow.dataset.editMode === 'true') {
        delete tagRow.dataset.editId;
        delete tagRow.dataset.editMode;
        // 恢复原始按钮HTML
        if (tagRow.dataset.origHtml) {
            tagRow.innerHTML = tagRow.dataset.origHtml;
            delete tagRow.dataset.origHtml;
        }
        const murmurSaveBtn = tagRow.querySelector('.insp-murmur-save-btn');
        if (murmurSaveBtn) murmurSaveBtn.style.display = 'none';
    }
}

// 从浮层保存
function saveInspirationFromModal(tag) {
    const textarea = document.getElementById('inspSaveModalText');
    const content = textarea.value.trim();
    if (!content) {
        showWechatToast('内容不能为空', 'info');
        return;
    }
    addInspirationItem(content, tag, '', 'chat', _inspSaveModalMsgId, _inspSaveModalAssistantId);
    closeInspSaveModal();
    showWechatToast(`已存 ${INSP_TAGS[tag]?.label || tag} 💭`, 'success');
}

// 核心：添加一条灵感
async function addInspirationItem(content, tag, url, source, msgId, assistantId) {
    if (!_inspirationDataLoaded) {
        console.warn('碎碎念数据未加载，先等待加载完成');
        await loadInspirationData();
    }
    const item = {
        id: 'insp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        content,
        tag,
        url: url || '',
        source: source || 'external',
        sourceMsgId: msgId || null,
        sourceAssistantId: assistantId || null,
        createdAt: new Date().toISOString()
    };
    inspirationData.items.unshift(item); // 新的在前
    saveInspirationData();
}

// 删除灵感
function deleteInspiration(id) {
    inspirationData.items = inspirationData.items.filter(i => i.id !== id);
    saveInspirationData();
    renderInspirationList();
    showWechatToast('已删除', 'info');
}

function confirmDeleteInspiration(id) {
    if (confirm('确定删除这条碎碎念吗？')) {
        deleteInspiration(id);
    }
}

function showInspDeleteConfirm(id) {
    const existing = document.querySelector('.insp-action-sheet');
    if (existing) existing.remove();
    const sheet = document.createElement('div');
    sheet.className = 'insp-action-sheet';
    sheet.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(90,72,112,0.35);z-index:1100;display:flex;align-items:flex-end;justify-content:center;';
    sheet.onclick = function(e) { if (e.target === sheet) sheet.remove(); };
    sheet.innerHTML = `
        <div style="background:#fdf8f0;border:2px solid #c0a8d8;border-radius:8px 8px 0 0;width:100%;max-width:420px;padding:8px 0;padding-bottom:max(8px,env(safe-area-inset-bottom,0px));animation:inspSheetSlideUp 0.25s ease;">
            <div style="padding:14px 20px;font-size:13px;text-align:center;color:#c8b8d8;font-family:ZLabsBitmap,monospace;">确定要删除这条碎碎念吗？</div>
            <div style="padding:14px 20px;font-size:15px;text-align:center;cursor:pointer;color:#c06060;font-family:ZLabsBitmap,monospace;" onclick="this.closest('.insp-action-sheet').remove();deleteInspiration('${id}')">删除</div>
            <div style="padding:14px 20px;font-size:15px;text-align:center;cursor:pointer;color:#b098c8;font-family:ZLabsBitmap,monospace;border-top:2px solid #ddd0e8;" onclick="this.closest('.insp-action-sheet').remove()">取消</div>
        </div>
    `;
    document.body.appendChild(sheet);
}

// 导出碎碎念为 MD
function exportInspirationMD() {
    const items = inspirationData.items || [];
    if (items.length === 0) {
        showWechatToast('还没有碎碎念可以导出', 'info');
        return;
    }

    // 按日期分组
    const groups = {};
    for (const item of items) {
        const dt = new Date(item.createdAt);
        const dateKey = `${dt.getFullYear()}-${(dt.getMonth()+1).toString().padStart(2,'0')}-${dt.getDate().toString().padStart(2,'0')}`;
        if (!groups[dateKey]) groups[dateKey] = [];
        groups[dateKey].push(item);
    }

    let md = `# 碎碎念\n\n`;
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    for (const date of sortedDates) {
        md += `## ${date}\n\n`;
        for (const item of groups[date]) {
            const tagInfo = INSP_TAGS[item.tag] || { label: item.tag };
            const dt = new Date(item.createdAt);
            const time = `${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}`;
            md += `### [${tagInfo.label}] ${time}\n\n`;
            md += `${item.content || ''}\n`;
            if (item.url) md += `\n🔗 ${item.url}\n`;
            md += `\n`;
        }
    }

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `碎碎念_${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showWechatToast('导出成功', 'success');
}

function copyInspiration(id) {
    const item = (inspirationData.items || []).find(i => i.id === id);
    if (!item) return;
    const text = item.content + (item.url ? '\n' + item.url : '');
    navigator.clipboard.writeText(text).then(() => {
        showWechatToast('已复制', 'success');
    }).catch(() => {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showWechatToast('已复制', 'success');
    });
}

function editInspiration(id) {
    const item = (inspirationData.items || []).find(i => i.id === id);
    if (!item) return;
    // 复用存碎碎念浮层来编辑
    const modal = document.getElementById('inspSaveModal');
    const textarea = document.getElementById('inspSaveModalText');
    textarea.value = item.content || '';
    modal.classList.add('show');
    const tagRow = modal.querySelector('.insp-tag-row');
    tagRow.dataset.editId = id;
    tagRow.dataset.editMode = 'true';

    if (item.tag === 'murmur') {
        // murmur：隐藏标签按钮，显示单独的保存按钮
        tagRow.querySelectorAll('.insp-tag-btn').forEach(btn => btn.style.display = 'none');
        let saveBtn = tagRow.querySelector('.insp-murmur-save-btn');
        if (!saveBtn) {
            saveBtn = document.createElement('button');
            saveBtn.className = 'insp-murmur-save-btn';
            saveBtn.textContent = '保存';
            saveBtn.style.cssText = 'padding:8px 36px;border:none;border-radius:10px;background:#c0a8d8;color:#fff;font-size:14px;cursor:pointer;font-family:"ZLabsBitmap",monospace;';
            tagRow.appendChild(saveBtn);
        }
        saveBtn.style.display = '';
        saveBtn.setAttribute('onclick', `saveInspEdit('${id}','murmur')`);
    } else {
        // 根据当前tag判断应该显示哪组标签
        const isLink = LINK_TAGS.includes(item.tag);
        const tagsToShow = isLink ? LINK_TAGS : TEXT_TAGS;

        // 隐藏murmur保存按钮
        const murmurSaveBtn = tagRow.querySelector('.insp-murmur-save-btn');
        if (murmurSaveBtn) murmurSaveBtn.style.display = 'none';

        // 动态替换标签按钮为对应类型
        // 先保存原始按钮HTML以便恢复
        if (!tagRow.dataset.origHtml) {
            tagRow.dataset.origHtml = tagRow.innerHTML;
        }
        // 生成对应类型的标签按钮
        const btnsHtml = tagsToShow.map(t =>
            `<button class="insp-tag-btn ${t}" onclick="saveInspEdit('${id}','${t}')">${INSP_TAGS[t].label}</button>`
        ).join('');
        // 保留murmur保存按钮（如果有的话）
        const murmurBtn = tagRow.querySelector('.insp-murmur-save-btn');
        tagRow.innerHTML = btnsHtml;
        if (murmurBtn) tagRow.appendChild(murmurBtn);
    }
    textarea.focus();
}

function saveInspEdit(id, newTag) {
    const textarea = document.getElementById('inspSaveModalText');
    const newContent = textarea.value.trim();
    if (!newContent) {
        showWechatToast('内容不能为空', 'info');
        return;
    }
    const item = (inspirationData.items || []).find(i => i.id === id);
    if (item) {
        item.content = newContent;
        item.tag = newTag;
    }
    saveInspirationData();
    renderInspirationList();
    // 恢复按钮原始行为
    const modal = document.getElementById('inspSaveModal');
    const tagRow = modal.querySelector('.insp-tag-row');
    delete tagRow.dataset.editId;
    delete tagRow.dataset.editMode;
    // 恢复原始按钮HTML
    if (tagRow.dataset.origHtml) {
        tagRow.innerHTML = tagRow.dataset.origHtml;
        delete tagRow.dataset.origHtml;
    }
    // 隐藏murmur专用保存按钮
    const murmurSaveBtn = tagRow.querySelector('.insp-murmur-save-btn');
    if (murmurSaveBtn) murmurSaveBtn.style.display = 'none';
    closeInspSaveModal();
    showWechatToast('已保存', 'success');
}

// 渲染列表
function renderInspirationList() {
    const container = document.getElementById('inspList');
    if (!container) return;

    let items = inspirationData.items || [];

    // 筛选
    if (inspCurrentFilter === 'link') {
        items = items.filter(i => LINK_TAGS.includes(i.tag));
        if (inspLinkSubFilter !== 'all') {
            items = items.filter(i => i.tag === inspLinkSubFilter);
        }
    } else if (inspCurrentFilter !== 'all') {
        items = items.filter(i => i.tag === inspCurrentFilter);
    }

    // 搜索
    const searchInput = document.getElementById('inspSearchInput');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (keyword) {
        items = items.filter(i =>
            (i.content || '').toLowerCase().includes(keyword) ||
            (i.url || '').toLowerCase().includes(keyword)
        );
    }

    if (items.length === 0) {
        container.innerHTML = `<div class="insp-empty">
            ${keyword ? '没有找到匹配的碎碎念' : (inspCurrentFilter !== 'all' ? '这个分类还没有碎碎念' : '还没有碎碎念，存一条试试？💭')}
        </div>`;
        return;
    }

    let html = '';
    for (const item of items) {
        const tagInfo = INSP_TAGS[item.tag] || { label: item.tag, color: '#999' };
        const dt = new Date(item.createdAt);
        const timeStr = `${(dt.getMonth()+1)}/${dt.getDate()} ${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}`;
        const sourceIcon = item.source === 'chat' ? '💬' : '📱';
        const sourceLabel = item.source === 'chat' ? '聊天' : '外部';
        const contentPreview = escapeHtml(item.content || '');
        const urlHtml = item.url ? `<a class="insp-card-url" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">🔗 ${escapeHtml(item.url)}</a>` : '';

        const cardClass = item.tag === 'murmur' ? 'murmur-card' : '';
        const barClass = item.tag === 'murmur' ? 'murmur-bar' : (LINK_TAGS.includes(item.tag) ? 'link-bar' : 'text-bar');
        html += `<div class="insp-card ${cardClass}" data-insp-id="${item.id}" >
            <div class="insp-card-titlebar ${barClass}">
                <span class="insp-tag ${item.tag}">${tagInfo.label}</span>
                <span class="insp-card-time">${timeStr}</span>
                <div class="insp-card-actions">
                    <button class="insp-card-action-btn" title="复制" onclick="event.stopPropagation();copyInspiration('${item.id}')"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="3" y="0" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="0" y="3" width="7" height="7" fill="#fdf8f0" stroke="currentColor" stroke-width="1.2"/></svg></button>
                    <button class="insp-card-action-btn" title="编辑" onclick="event.stopPropagation();editInspiration('${item.id}')"><svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="10" width="8" height="1.2"/><rect x="8" y="1" width="2" height="2"/><rect x="3" y="6" width="2" height="2"/><rect x="5" y="4" width="2" height="2"/><rect x="7" y="2" width="2" height="2"/><rect x="2" y="8" width="2" height="2"/></svg></button>
                    <button class="insp-card-action-btn" title="删除" onclick="event.stopPropagation();showInspDeleteConfirm('${item.id}')"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="2" height="2"/><rect x="7" y="1" width="2" height="2"/><rect x="3" y="3" width="2" height="2"/><rect x="5" y="3" width="2" height="2"/><rect x="4" y="4" width="2" height="2"/><rect x="3" y="5" width="2" height="2"/><rect x="5" y="5" width="2" height="2"/><rect x="1" y="7" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/></svg></button>
                </div>
            </div>
            <div class="insp-card-body">
                <div class="insp-card-content">${contentPreview}</div>
            </div>
            ${urlHtml ? `<div class="insp-card-footer">${urlHtml}</div>` : ''}
        </div>`;
    }
    container.innerHTML = html;

    // 检测截断，添加展开/收起按钮
    container.querySelectorAll('.insp-card-content').forEach(el => {
        if (el.scrollHeight > el.clientHeight) {
            const btn = document.createElement('div');
            btn.className = 'insp-expand-btn';
            btn.textContent = '···';
            btn.onclick = function() {
                const isExpanded = el.classList.toggle('expanded');
                if (isExpanded) {
                    if (typeof marked !== 'undefined') {
                        el.innerHTML = marked.parse(el.getAttribute('data-raw') || el.textContent);
                    }
                    btn.textContent = '收起';
                } else {
                    el.textContent = el.getAttribute('data-raw') || el.textContent;
                    btn.textContent = '···';
                }
            };
            el.setAttribute('data-raw', el.textContent);
            el.parentElement.appendChild(btn);
        }
    });
}

// 碎碎念语音输入
function startInspirationVoiceInput() {
    if (voiceRecognition) {
        stopVoiceInputCommon();
        return;
    }
    voiceInputTarget = 'inspiration';
    startVoiceInputCommon();
}

