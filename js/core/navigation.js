/**
 * core/navigation.js - 页面导航
 *
 * 暴露函数：openPage, closePage, openSettings, populateGlobalModelDropdown,
 *          populateSecondaryModelDropdown, saveGlobalDefaultModel, saveBackendUrl
 * 依赖：appData (data.js), saveData (storage.js), renderProviderList (providers.js),
 *       renderAssistantList (assistants.js), stopVoiceInputCommon (stt.js),
 *       updateCloudSyncStatusDisplay (cloud-sync.js), updateSettingsCounts (display.js)
 */

function openPage(pageId) {
    document.getElementById(pageId).classList.add('active');
    if (pageId === 'providerPage') renderProviderList();
    if (pageId === 'assistantPage') renderAssistantList();
}

function closePage(pageId) {
    document.getElementById(pageId).classList.remove('active');
    updateSettingsCounts();
    // 离开聊天页面时停止语音识别
    if ((pageId === 'chatPage' || pageId === 'wechatChatPage') && voiceRecognition) {
        stopVoiceInputCommon();
    }
}

function openSettings() {
    populateGlobalModelDropdown();
    populateSecondaryModelDropdown();
    // 后端地址
    const backendInput = document.getElementById('backendUrlInput');
    if (backendInput) backendInput.value = appData.settings.backendUrl || '';
    // 云端备份
    const supabaseUrlInput = document.getElementById('supabaseUrlInput');
    const supabaseKeyInput = document.getElementById('supabaseKeyInput');
    if (supabaseUrlInput) supabaseUrlInput.value = appData.settings.supabaseUrl || '';
    if (supabaseKeyInput) supabaseKeyInput.value = appData.settings.supabaseKey || '';
    updateCloudSyncStatusDisplay();
    openPage('settingsPage');
}

// 填充全局默认模型下拉框
function populateGlobalModelDropdown() {
    const select = document.getElementById('globalDefaultModel');
    if (!select) return;

    // 获取启用的供应商和模型
    const enabledProviders = appData.providers.filter(p => p.models && p.models.length > 0);

    let html = '<option value="">请选择默认模型</option>';
    enabledProviders.forEach(p => {
        html += `<optgroup label="${p.name}">`;
        p.models.forEach(m => {
            html += `<option value="${p.id}||${m.id}">${m.name || m.id}</option>`;
        });
        html += '</optgroup>';
    });
    select.innerHTML = html;

    // 设置当前值
    if (appData.settings.defaultModel) {
        select.value = appData.settings.defaultModel;
    }
}

// 填充副模型下拉框
function populateSecondaryModelDropdown() {
    const select = document.getElementById('globalSecondaryModel');
    if (!select) return;

    const enabledProviders = appData.providers.filter(p => p.models && p.models.length > 0);

    let html = '<option value="">使用主模型</option>';
    enabledProviders.forEach(p => {
        html += `<optgroup label="${p.name}">`;
        p.models.forEach(m => {
            html += `<option value="${p.id}||${m.id}">${m.name || m.id}</option>`;
        });
        html += '</optgroup>';
    });
    select.innerHTML = html;

    if (appData.settings.secondaryModel) {
        select.value = appData.settings.secondaryModel;
    }
}

// 保存全局默认模型
function saveGlobalDefaultModel() {
    const select = document.getElementById('globalDefaultModel');
    appData.settings.defaultModel = select.value;
    saveData();
}

// 保存后端地址
function saveBackendUrl() {
    let url = document.getElementById('backendUrlInput').value.trim();
    // 去掉末尾斜杠
    if (url.endsWith('/')) url = url.replace(/\/+$/, '');
    appData.settings.backendUrl = url;
    saveData();
}
