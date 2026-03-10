/**
 * core/data.js - 全局数据结构定义
 *
 * 暴露：appData, thinkingConfig, _appDataLoaded, editingAssistantId,
 *       currentManagingProviderId, fetchedModels, editingMessageId
 * 依赖：无（纯数据定义）
 */

let appData = {
    providers: [],
    assistants: [],
    conversations: [],
    messages: {},
    currentConversationId: null,
    currentAssistantId: null,
    settings: {
        thinkingLevel: 'medium' // off, auto, low, medium, high
    },
    ttsSettings: {
        engine: 'minimax',       // 'minimax' | 'edge'
        groupId: '',
        apiKey: '',
        model: 'speech-02-hd',
        domain: 'api.minimax.chat',
        edgeWorkerUrl: '',
        edgeWorkerKey: '',
        minimaxWorkerUrl: '',
        minimaxWorkerKey: ''
    }
};

let _appDataLoaded = false;
let editingAssistantId = null;
let currentManagingProviderId = null;
let fetchedModels = [];
let editingMessageId = null;

// 思考级别配置
const thinkingConfig = {
    off: { label: '关闭', tokens: 0 },
    auto: { label: '自动', tokens: 0 },
    low: { label: '轻度推理', tokens: 1024 },
    medium: { label: '中度推理', tokens: 16000 },
    high: { label: '重度推理', tokens: 32000 }
};
