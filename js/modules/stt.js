/**
 * STT 语音识别模块
 * 负责：讯飞流式 STT、Web Speech API 降级、公共 start/stop/cancel、音频路由重置
 * 暴露函数：startVoiceInputCommon, stopVoiceInputCommon, cancelVoiceInput,
 *          startApiVoiceInput, startWechatVoiceInput, xfFloat32ToInt16,
 *          xfArrayBufferToBase64, resetAudioRoute, sendVoiceInput, onVoicePreviewEdit
 * 依赖：appData(data.js), closeWechatPlusPanel(微信模块)
 */

// 用户语音输入相关
let voiceRecognition = null;  // non-null = 正在录音（Web Speech API 对象或 {type:'xfyun'} 标记）
let voicePendingText = '';
let voiceProcessedCount = 0;
let voiceInputTarget = 'wechat';  // 'wechat' | 'api' | 'inspiration'

// 讯飞 STT 状态
let xfyunWs = null;
let xfyunAudioContext = null;
let xfyunMicStream = null;
let xfyunProcessor = null;
let xfyunSourceNode = null;
let xfyunResults = {};  // {sn: text} 用于组装识别结果

function getVoiceTargetInput() {
    if (voiceInputTarget === 'api') return document.getElementById('chatInput');
    if (voiceInputTarget === 'inspiration') return document.getElementById('inspirationInput');
    return document.getElementById('wechatInput');
}

function getVoiceTargetBtn() {
    if (voiceInputTarget === 'api') return document.querySelector('#chatPage .wechat-voice-btn');
    if (voiceInputTarget === 'inspiration') return document.querySelector('#inspirationPage .insp-voice-btn');
    return document.querySelector('#wechatChatPage .wechat-voice-btn');
}

function startApiVoiceInput() {
    if (voiceRecognition) {
        stopVoiceInputCommon();
        return;
    }
    voiceInputTarget = 'api';
    startVoiceInputCommon();
}

function startWechatVoiceInput() {
    if (voiceRecognition) {
        stopVoiceInputCommon();
        return;
    }
    closeWechatPlusPanel();
    voiceInputTarget = 'wechat';
    startVoiceInputCommon();
}

// 语音识别入口：优先讯飞，降级 Web Speech API
function startVoiceInputCommon() {
    if (appData.settings.backendUrl) {
        startXfyunVoiceInput();
    } else {
        startWebSpeechInput();
    }
}

// ---- 讯飞流式语音识别 ----
async function startXfyunVoiceInput() {
    // 先清理可能残留的旧会话
    if (xfyunWs || xfyunMicStream || xfyunAudioContext) {
        console.log('清理残留的讯飞资源');
        xfCleanupAll();
    }

    // 重置状态，保留输入框已有内容
    const input = getVoiceTargetInput();
    voicePendingText = input.value || '';
    xfyunResults = {};

    // 录音中视觉反馈
    const btn = getVoiceTargetBtn();
    if (btn) btn.classList.add('recording');

    try {
        // 标记为正在启动，防止重复启动
        voiceRecognition = { type: 'xfyun' };

        // 1. 从后端获取签名 URL
        const backendUrl = appData.settings.backendUrl;
        console.log('请求讯飞签名...');
        const signResp = await fetch(`${backendUrl}/api/stt-sign`);
        if (!signResp.ok) throw new Error('签名请求失败: ' + signResp.status);
        const { url, appid } = await signResp.json();

        // 2. 获取麦克风权限
        xfyunMicStream = await navigator.mediaDevices.getUserMedia({
            audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
        });

        // 3. 创建 AudioContext 提取 PCM 数据
        xfyunAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        xfyunSourceNode = xfyunAudioContext.createMediaStreamSource(xfyunMicStream);
        xfyunProcessor = xfyunAudioContext.createScriptProcessor(4096, 1, 1);

        // 4. 连接讯飞 WebSocket
        xfyunWs = new WebSocket(url);
        let frameCount = 0;

        xfyunWs.onopen = () => {
            console.log('讯飞 WebSocket 已连接');

            // 开始发送音频数据
            xfyunProcessor.onaudioprocess = (e) => {
                if (!xfyunWs || xfyunWs.readyState !== WebSocket.OPEN) return;

                const float32 = e.inputBuffer.getChannelData(0);
                const int16 = xfFloat32ToInt16(float32);
                const base64Audio = xfArrayBufferToBase64(int16.buffer);

                const frame = {
                    data: {
                        status: frameCount === 0 ? 0 : 1,
                        format: 'audio/L16;rate=16000',
                        encoding: 'raw',
                        audio: base64Audio
                    }
                };

                // 第一帧附带 common 和 business 参数
                if (frameCount === 0) {
                    frame.common = { app_id: appid };
                    frame.business = {
                        language: 'zh_cn',
                        domain: 'iat',
                        accent: 'mandarin',
                        vad_eos: 60000,
                        dwa: 'wpgs',
                        ptt: 1
                    };
                }

                xfyunWs.send(JSON.stringify(frame));
                frameCount++;
            };

            xfyunSourceNode.connect(xfyunProcessor);
            xfyunProcessor.connect(xfyunAudioContext.destination);
        };

        xfyunWs.onmessage = (event) => {
            try {
                const resp = JSON.parse(event.data);
                if (resp.code !== 0) {
                    console.error('讯飞识别错误:', resp.code, resp.message);
                    return;
                }
                xfParseResult(resp);
            } catch (e) {
                console.error('讯飞消息解析失败:', e);
            }
        };

        xfyunWs.onclose = () => {
            console.log('讯飞 WebSocket 关闭（60秒到期或手动停止）');
            // 把当前未合并的结果存入 pendingText
            const keys = Object.keys(xfyunResults).map(Number).sort((a, b) => a - b);
            const remainText = keys.map(k => xfyunResults[k]).join('');
            if (remainText) voicePendingText += remainText;
            xfyunResults = {};

            // 清理音频资源
            xfCleanupAudio();

            // 60秒到期：结束录音，图标变灰，用户想继续说可以再点麦克风
            if (voiceRecognition?.type === 'xfyun') {
                voiceRecognition = null;
                document.querySelectorAll('.wechat-voice-btn.recording, .insp-voice-btn.recording').forEach(b => b.classList.remove('recording'));
                resetAudioRoute();
                console.log('讯飞识别已结束，点击麦克风可继续');
            }
        };

        xfyunWs.onerror = (e) => {
            console.error('讯飞 WebSocket 错误:', e);
            xfCleanupAll();
            voiceRecognition = null;
            // 降级到 Web Speech API
            console.log('讯飞不可用，降级到浏览器语音识别');
            startWebSpeechInput();
        };

    } catch (e) {
        console.error('讯飞语音识别启动失败:', e);
        xfCleanupAll();
        voiceRecognition = null;
        // 移除录音按钮状态
        document.querySelectorAll('.wechat-voice-btn.recording, .insp-voice-btn.recording').forEach(b => b.classList.remove('recording'));
        if (e.name === 'NotAllowedError' || e.message?.includes('Permission')) {
            console.warn('麦克风权限被拒绝，不降级');
            alert('请允许麦克风权限后重试');
        } else {
            // 降级到 Web Speech API
            console.log('讯飞启动失败，降级到浏览器语音识别');
            startWebSpeechInput();
        }
    }
}

// 解析讯飞识别结果
function xfParseResult(resp) {
    const result = resp.data?.result;
    if (!result) return;

    const sn = result.sn;
    const pgs = result.pgs;

    // 从 ws 数组中提取文字
    let text = '';
    if (result.ws) {
        result.ws.forEach(w => {
            w.cw.forEach(c => { text += c.w; });
        });
    }

    // rpl 模式：替换指定范围的结果
    if (pgs === 'rpl' && result.rg) {
        for (let i = result.rg[0]; i <= result.rg[1]; i++) {
            if (i !== sn) delete xfyunResults[i];
        }
    }

    xfyunResults[sn] = text;

    // 组装完整识别文本
    const keys = Object.keys(xfyunResults).map(Number).sort((a, b) => a - b);
    const fullText = keys.map(k => xfyunResults[k]).join('');

    // 更新输入框
    const targetInput = getVoiceTargetInput();
    targetInput.value = voicePendingText + fullText;
    targetInput.style.height = 'auto';
    targetInput.style.height = Math.min(targetInput.scrollHeight, 120) + 'px';
    targetInput.scrollTop = targetInput.scrollHeight;

    // 讯飞返回 status=2 表示最终结果，把文本合入 pendingText
    if (resp.data.status === 2) {
        voicePendingText += fullText;
        xfyunResults = {};
    }
}

// PCM 工具函数
function xfFloat32ToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
}

function xfArrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// 清理讯飞音频资源（保留 WebSocket）
function xfCleanupAudio() {
    if (xfyunProcessor) {
        xfyunProcessor.onaudioprocess = null;
        try { xfyunProcessor.disconnect(); } catch(e) {}
        xfyunProcessor = null;
    }
    if (xfyunSourceNode) {
        try { xfyunSourceNode.disconnect(); } catch(e) {}
        xfyunSourceNode = null;
    }
    // 先释放麦克风 stream，再关 AudioContext
    if (xfyunMicStream) {
        xfyunMicStream.getTracks().forEach(t => t.stop());
        xfyunMicStream = null;
    }
    if (xfyunAudioContext) {
        xfyunAudioContext.close().catch(() => {});
        xfyunAudioContext = null;
    }
}

// 完全清理讯飞所有资源
function xfCleanupAll() {
    if (xfyunWs) {
        // 发送结束帧
        if (xfyunWs.readyState === WebSocket.OPEN) {
            try {
                xfyunWs.send(JSON.stringify({
                    data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' }
                }));
            } catch (e) {}
        }
        xfyunWs.onclose = null;
        xfyunWs.onerror = null;
        xfyunWs.onmessage = null;
        xfyunWs.close();
        xfyunWs = null;
    }
    xfCleanupAudio();
    xfyunResults = {};
}

// ---- Web Speech API（降级方案） ----
function startWebSpeechInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert('您的浏览器不支持语音识别功能，请使用Chrome或Edge浏览器');
        return;
    }

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = 'zh-CN';
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;

    // 重置状态，保留输入框已有内容
    voiceProcessedCount = 0;
    const input = getVoiceTargetInput();
    voicePendingText = input.value || '';

    // 录音中视觉反馈
    const btn = getVoiceTargetBtn();
    if (btn) btn.classList.add('recording');

    voiceRecognition.onresult = (event) => {
        let interim = '';
        let finalText = '';
        for (let i = voiceProcessedCount; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                finalText += event.results[i][0].transcript;
                voiceProcessedCount = i + 1;
            } else {
                interim += event.results[i][0].transcript;
            }
        }

        if (finalText) {
            voicePendingText += finalText;
        }

        const display = voicePendingText + interim;
        const targetInput = getVoiceTargetInput();
        targetInput.value = display;
        // 自动调整高度
        targetInput.style.height = 'auto';
        targetInput.style.height = Math.min(targetInput.scrollHeight, 120) + 'px';
        targetInput.scrollTop = targetInput.scrollHeight;
    };

    voiceRecognition.onerror = (event) => {
        console.warn('语音识别错误:', event.error);
        if (event.error === 'no-speech' || event.error === 'aborted') {
            setTimeout(() => {
                if (voiceRecognition) {
                    try { voiceRecognition.start(); } catch(e) {}
                }
            }, 500);
        } else if (event.error === 'not-allowed') {
            alert('请允许麦克风权限');
            stopVoiceInputCommon();
        }
    };

    voiceRecognition.onend = () => {
        // 自动重启（和语音通话一样的逻辑）
        const pageId = voiceInputTarget === 'api' ? 'chatPage' : (voiceInputTarget === 'inspiration' ? 'inspirationPage' : 'wechatChatPage');
        const page = document.getElementById(pageId);
        if (voiceRecognition && page && page.classList.contains('active')) {
            setTimeout(() => {
                if (voiceRecognition) {
                    try {
                        voiceProcessedCount = 0;
                        voiceRecognition.start();
                    } catch(e) {}
                }
            }, 300);
        }
    };

    try {
        voiceRecognition.start();
    } catch (e) {
        console.error('启动语音识别失败:', e);
        stopVoiceInputCommon();
    }
}

function stopVoiceInputCommon() {
    if (voiceRecognition?.type === 'xfyun') {
        // 停止讯飞
        xfCleanupAll();
    } else if (voiceRecognition) {
        // 停止 Web Speech API
        voiceRecognition.onend = null;
        voiceRecognition.stop();
    }
    voiceRecognition = null;
    voicePendingText = '';
    // 移除录音视觉状态
    document.querySelectorAll('.wechat-voice-btn.recording, .insp-voice-btn.recording').forEach(b => b.classList.remove('recording'));
    // 重置音频路由
    resetAudioRoute();
}

function cancelVoiceInput() {
    stopVoiceInputCommon();
    document.getElementById('voiceInputModal').classList.remove('show');
}

// 重置音频路由（修复语音识别后TTS外放问题）
// 使用多种方法尝试重置音频会话
function resetAudioRoute() {
    try {
        // 方法1: 使用 AudioContext 播放静音（更底层的音频控制）
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            const ctx = new AudioContextClass();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            gainNode.gain.value = 0.001; // 几乎静音
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            oscillator.start();
            oscillator.stop(ctx.currentTime + 0.1);
            setTimeout(() => ctx.close(), 200);
        }

        // 方法2: 同时播放 HTML Audio 元素
        const silentAudio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
        silentAudio.volume = 0.01;
        silentAudio.play().catch(() => {});

        console.log('音频路由重置已尝试');
    } catch (e) {
        console.warn('重置音频路由失败:', e);
    }
}

// 保留旧函数避免弹窗按钮报错
function sendVoiceInput() { cancelVoiceInput(); }
function onVoicePreviewEdit() {}
