/**
 * core/storage.js - IndexedDB 和 localStorage 存储
 *
 * 暴露函数：initIndexedDB, saveToIndexedDB, loadFromIndexedDB, migrateFromLocalStorage,
 *          saveData, loadData, saveToLocalStorage
 * 暴露变量：DB_NAME, DB_VERSION, dbInstance, lastStorageWarningTime
 * 依赖：appData, _appDataLoaded, _cloudSyncDirty (core/data.js, core/cloud-sync.js)
 */

const DB_NAME = 'MiaomiaoChat';
const DB_VERSION = 3;
let dbInstance = null;

// 初始化 IndexedDB
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            console.warn('浏览器不支持IndexedDB，将使用localStorage');
            resolve(null);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('IndexedDB打开失败:', request.error);
            resolve(null);
        };

        request.onsuccess = () => {
            dbInstance = request.result;
            console.log('IndexedDB初始化成功');
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // 创建数据存储
            if (!db.objectStoreNames.contains('appData')) {
                db.createObjectStore('appData', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('wechatData')) {
                db.createObjectStore('wechatData', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('voiceCallData')) {
                db.createObjectStore('voiceCallData', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('voiceCallAudio')) {
                db.createObjectStore('voiceCallAudio', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('inspirationData')) {
                db.createObjectStore('inspirationData', { keyPath: 'id' });
            }
            console.log('IndexedDB数据库结构创建完成');
        };
    });
}

// 通用保存函数
function saveToIndexedDB(storeName, data) {
    return new Promise((resolve) => {
        if (!dbInstance) {
            resolve(false);
            return;
        }
        try {
            const transaction = dbInstance.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put({ id: 'main', data: data });

            request.onsuccess = () => resolve(true);
            request.onerror = () => {
                console.error(`IndexedDB保存${storeName}失败:`, request.error);
                resolve(false);
            };
        } catch (e) {
            console.error(`IndexedDB保存${storeName}异常:`, e);
            resolve(false);
        }
    });
}

// 通用读取函数
function loadFromIndexedDB(storeName) {
    return new Promise((resolve) => {
        if (!dbInstance) {
            resolve(null);
            return;
        }
        try {
            const transaction = dbInstance.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get('main');

            request.onsuccess = () => {
                resolve(request.result?.data || null);
            };
            request.onerror = () => {
                console.error(`IndexedDB读取${storeName}失败:`, request.error);
                resolve(null);
            };
        } catch (e) {
            console.error(`IndexedDB读取${storeName}异常:`, e);
            resolve(null);
        }
    });
}

// 从 localStorage 迁移数据到 IndexedDB
async function migrateFromLocalStorage() {
    // 迁移 API 模式数据
    const apiData = localStorage.getItem('miaomiao_chat_v5');
    if (apiData) {
        try {
            const parsed = JSON.parse(apiData);
            const saved = await saveToIndexedDB('appData', parsed);
            if (saved) {
                localStorage.removeItem('miaomiao_chat_v5');
                console.log('API模式数据已从localStorage迁移到IndexedDB');
            }
        } catch (e) {
            console.error('迁移API数据失败:', e);
        }
    }

    // 迁移微信模式数据
    const wechatDataStr = localStorage.getItem('miaomiao_wechat_v1');
    if (wechatDataStr) {
        try {
            const parsed = JSON.parse(wechatDataStr);
            const saved = await saveToIndexedDB('wechatData', parsed);
            if (saved) {
                localStorage.removeItem('miaomiao_wechat_v1');
                console.log('微信模式数据已从localStorage迁移到IndexedDB');
            }
        } catch (e) {
            console.error('迁移微信数据失败:', e);
        }
    }
}

// ==================== 本地存储（使用IndexedDB，降级到localStorage） ====================
function saveData() {
    if (!_appDataLoaded) {
        console.warn('appData尚未加载完成，跳过保存以防覆盖');
        return false;
    }
    // 优先使用 IndexedDB
    if (dbInstance) {
        saveToIndexedDB('appData', appData).then(success => {
            if (!success) {
                console.warn('IndexedDB保存失败，尝试localStorage');
                saveToLocalStorage();
            }
        });
        _cloudSyncDirty.appData = true;
        return true;
    }
    // 降级到 localStorage
    _cloudSyncDirty.appData = true;
    return saveToLocalStorage();
}

let lastStorageWarningTime = 0; // 防止频繁弹窗

function saveToLocalStorage() {
    try {
        localStorage.setItem('miaomiao_chat_v5', JSON.stringify(appData));
        return true;
    } catch (e) {
        console.error('localStorage保存失败:', e);
        if (e.name === 'QuotaExceededError' || e.message.includes('quota')) {
            // 每5分钟最多提示一次，避免频繁打扰
            const now = Date.now();
            if (now - lastStorageWarningTime > 300000) {
                lastStorageWarningTime = now;
                alert('⚠️ 存储空间已满，消息可能无法保存！\n建议导出数据后清理不需要的对话。');
            }
        }
        return false;
    }
}

async function loadData() {
    // 优先从 IndexedDB 加载
    if (dbInstance) {
        const saved = await loadFromIndexedDB('appData');
        if (saved) {
            appData = { ...appData, ...saved };
            migrateTtsSettings();
            migratePartner();
            _appDataLoaded = true;
            return;
        }
    }
    // 降级到 localStorage
    const saved = localStorage.getItem('miaomiao_chat_v5');
    if (saved) {
        appData = { ...appData, ...JSON.parse(saved) };
        migrateTtsSettings();
        migratePartner();
    }
    _appDataLoaded = true;
}

// 确保 partner 字段存在（旧数据兼容）
function migratePartner() {
    if (!appData.partner) {
        appData.partner = {
            id: 'partner_default',
            version: 1,
            profile: { name: '', avatar: '', signature: '' },
            soul: '',
            user: '',
            bond: '',
            rules: '',
            model: { providerId: '', defaultModel: '', temperature: 0.7, maxTokens: 0 },
            voice: { ttsEngine: 'edge', voiceId: '', edgeVoiceId: '', emotionMapping: true },
            memory: { vectorMemoryEnabled: false, longTermMemoryEnabled: false, memoryEntries: [] },
            consciousness: { enabled: false, heartbeatInterval: 300, explorationEnabled: false, activeHours: { start: 8, end: 23 } },
            tools: { searchEnabled: false, browseEnabled: false, summaryEnabled: false }
        };
    }
    // 确保子字段存在
    if (!appData.partner.profile) appData.partner.profile = { name: '', avatar: '', signature: '' };
    if (!appData.partner.model) appData.partner.model = { providerId: '', defaultModel: '', temperature: 0.7, maxTokens: 0 };
    if (!appData.partner.voice) appData.partner.voice = { ttsEngine: 'edge', voiceId: '', edgeVoiceId: '', emotionMapping: true };
    if (!appData.partner.memory) appData.partner.memory = { vectorMemoryEnabled: false, longTermMemoryEnabled: false, memoryEntries: [] };
}

// 确保 ttsSettings 有新字段（旧数据兼容）
function migrateTtsSettings() {
    const tts = appData.ttsSettings;
    if (!tts) return;
    if (!tts.engine) tts.engine = 'minimax';
    if (tts.edgeWorkerUrl === undefined) tts.edgeWorkerUrl = '';
    if (tts.edgeWorkerKey === undefined) tts.edgeWorkerKey = '';

    // 迁移 API 模式全局设置
    if (appData.settings.apiContextLength === undefined) {
        const assistant = appData.assistants.find(a => a.id === appData.currentAssistantId);
        appData.settings.apiContextLength = assistant?.contextLength || 20;
    }
    if (appData.settings.apiStreamEnabled === undefined) {
        appData.settings.apiStreamEnabled = true;
    }
}
