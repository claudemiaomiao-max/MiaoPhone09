/**
 * TTS / 音频系统模块
 * 负责：Edge TTS、MiniMax TTS、情绪映射、音频解锁、活人感增强、TTS 设置
 * 暴露函数：preUnlockAudioElement, unlockAudio, playEdgeTts, playTtsAudio,
 *          playTtsAudioWithCallback, isTtsConfigured, stripInterjections,
 *          stripInterjectionsAlways, normalizeEmotion, isSpeech28Model, addNaturalPauses,
 *          toggleTtsEngineFields, openTtsSettings, saveTtsSettings, updateTtsStatus,
 *          populateEdgeVoiceSelect, getEdgeVoiceGender, toggleVoiceIdFields
 * 依赖：appData(data.js), saveData(storage.js), wechatData(微信模块), resetAudioRoute(stt.js)
 */

// 当前播放的音频
let currentTtsAudio = null;
// TTS缓存，避免重复收费
const ttsCache = new Map();
// 音频是否已解锁（移动端需要用户交互后才能播放音频）
let audioUnlocked = false;

// 静音音频（用于在用户手势中预解锁Audio元素）
const SILENT_AUDIO_SRC = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwmHAAAAAAD/+9DEAAAIAANIAAAAgAADSAAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tQxBkAAADSAAAAAAAAANIAAAAA//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=';

// 预解锁Audio元素（在用户手势的同步调用栈中调用）
// Safari要求audio.play()在用户手势中，异步fetch后手势上下文会丢失
// 所以在点击时立即创建并播放静音音频来"激活"这个元素，
// 之后对同一元素改src再play，Safari会允许
function preUnlockAudioElement() {
    const audio = new Audio(SILENT_AUDIO_SRC);
    audio.volume = 0.01;
    audio.play().then(() => {
        audio.pause();
        audio.volume = 1;
    }).catch(() => {});
    return audio;
}

// 解锁音频（在首次用户交互时调用）
function unlockAudio() {
    if (audioUnlocked) return;
    const silentAudio = new Audio(SILENT_AUDIO_SRC);
    silentAudio.volume = 0.01;
    silentAudio.play().then(() => {
        audioUnlocked = true;
        console.log('音频已解锁');
    }).catch(() => {});
}

// 在页面首次点击/触摸时解锁音频
document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('touchstart', unlockAudio, { once: true });

// ==================== TTS调试工具 ====================
// 在eruda控制台输入 testTTS() 即可测试
window.testTTS = async function() {
    const tts = appData.ttsSettings;
    console.log('=== TTS调试开始 ===');
    console.log('engine:', tts.engine);
    console.log('domain:', tts.domain);
    console.log('groupId:', tts.groupId);
    console.log('apiKey:', tts.apiKey ? (tts.apiKey.substring(0, 10) + '...') : '空');
    console.log('model:', tts.model);

    console.log('minimaxWorkerUrl:', tts.minimaxWorkerUrl || '未配置（直连）');

    const testBody = {
        model: tts.model,
        text: '测试',
        stream: false,
        output_format: 'url',
        voice_setting: {
            voice_id: 'male-qn-qingse',
            speed: 1.0,
            vol: 1.0,
            pitch: 0
        },
        audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: 'mp3',
            channel: 1
        }
    };

    try {
        let response;
        if (tts.minimaxWorkerUrl) {
            const workerUrl = tts.minimaxWorkerUrl.replace(/\/+$/, '');
            const workerHeaders = { 'Content-Type': 'application/json' };
            if (tts.minimaxWorkerKey) {
                workerHeaders['Authorization'] = 'Bearer ' + tts.minimaxWorkerKey;
            }
            console.log('走Worker代理:', workerUrl);
            response = await fetch(workerUrl, {
                method: 'POST',
                headers: workerHeaders,
                body: JSON.stringify({
                    groupId: tts.groupId,
                    apiKey: tts.apiKey,
                    domain: tts.domain,
                    requestBody: testBody
                })
            });
        } else {
            const url = `https://${tts.domain}/v1/text_to_speech?GroupId=${tts.groupId}`;
            console.log('直连URL:', url);
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + tts.apiKey
                },
                body: JSON.stringify(testBody)
            });
        }
        console.log('HTTP状态:', response.status);
        const data = await response.json();
        console.log('响应:', JSON.stringify(data).substring(0, 300));
        if (data?.data?.audio) {
            console.log('✅ 成功拿到音频URL');
            new Audio(data.data.audio).play();
        } else {
            console.log('❌ 没有音频URL，错误:', data?.base_resp?.status_msg);
        }
    } catch (e) {
        console.error('❌ fetch失败:', e.name, e.message);
    }
    console.log('=== TTS调试结束 ===');
};

// ==================== 语音活人感增强 ====================

// Edge TTS 音色列表
const EDGE_TTS_VOICES = {
    female: [
        { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (温暖)' },
        { id: 'zh-CN-XiaoyiNeural', name: '晓伊 (活泼)' },
        { id: 'zh-TW-HsiaoYuNeural', name: '曉語 (台灣女聲)' },
        { id: 'zh-TW-HsiaoChenNeural', name: '曉臻 (台灣女聲)' }
    ],
    male: [
        { id: 'zh-CN-YunxiNeural', name: '云希 (少年)' },
        { id: 'zh-CN-YunjianNeural', name: '云健 (沉稳)' },
        { id: 'zh-CN-YunyangNeural', name: '云扬 (新闻)' },
        { id: 'zh-CN-YunxiaNeural', name: '云夏 (童声)' },
        { id: 'zh-TW-YunJheNeural', name: '雲哲 (台灣男聲)' }
    ]
};

// Edge TTS 情绪参数映射（SSML prosody 格式）
const EDGE_EMOTION_PARAMS = {
    happy:     { rate: '+12%',  pitch: '+3Hz',  volume: '+10%' },
    sad:       { rate: '-8%',   pitch: '-3Hz',  volume: '-15%' },
    angry:     { rate: '+15%',  pitch: '+0Hz',  volume: '+20%' },
    fearful:   { rate: '+12%',  pitch: '+3Hz',  volume: '-5%' },
    disgusted: { rate: '+5%',   pitch: '-2Hz',  volume: '+5%' },
    surprised: { rate: '+8%',   pitch: '+5Hz',  volume: '+10%' },
    calm:      { rate: '+0%',   pitch: '+0Hz',  volume: '+0%' },
    neutral:   { rate: '+0%',   pitch: '+0Hz',  volume: '+0%' },
    tender:    { rate: '-3%',   pitch: '+0Hz',  volume: '-10%' },
    playful:   { rate: '+12%',  pitch: '+3Hz',  volume: '+10%' }
};

// MiniMax 原生支持的情绪（全版本通用7个）
const MINIMAX_EMOTIONS = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm'];

// 旧情绪 → MiniMax原生情绪的 fallback 映射
const EMOTION_FALLBACK = {
    tender: 'calm',
    playful: 'happy',
    neutral: 'calm'
};

// 标准化情绪值（兼容旧上下文）
function normalizeEmotion(emotion) {
    if (!emotion) return 'calm';
    const e = emotion.toLowerCase();
    if (MINIMAX_EMOTIONS.includes(e)) return e;
    return EMOTION_FALLBACK[e] || 'calm';
}

// 检测是否为 2.8 模型（支持拟声词标签）
function isSpeech28Model() {
    const model = appData.ttsSettings.model || '';
    return model.includes('2.8');
}

// 非2.8模型时去除拟声词标签，避免被朗读出来
function stripInterjections(text) {
    if (isSpeech28Model()) return text;
    return stripInterjectionsAlways(text);
}

// 无条件去除拟声词标签（用于显示端，不让用户看到标签）
function stripInterjectionsAlways(text) {
    return text.replace(/\((laughs|chuckle|coughs|clear-throat|groans|breath|pant|inhale|exhale|gasps|sniffs|sighs|snorts|burps|lip-smacking|humming|hissing|emm|whistles|sneezes|crying|applause)\)/gi, '');
}

// 添加自然停顿 - MiniMax专用格式 <#秒数#>
function addNaturalPauses(text) {
    let result = text;

    // 1. 句首轻微停顿（呼吸感）
    result = '<#0.05#>' + result;

    // 2. 问号特殊处理：在问号前加微停顿模拟上扬语调
    result = result.replace(/([^<])？/g, '$1<#0.08#>？<#0.3#>');
    result = result.replace(/([^<])\?/g, '$1<#0.08#>?<#0.3#>');

    // 3. 其他标点停顿
    result = result
        .replace(/，/g, '，<#0.15#>')
        .replace(/。/g, '。<#0.35#>')
        .replace(/！/g, '！<#0.3#>')
        .replace(/、/g, '、<#0.1#>')
        .replace(/……/g, '……<#0.5#>')
        .replace(/～/g, '～<#0.2#>');

    // 清理可能的重复停顿标记（保留较长的）
    result = result.replace(/<#[\d.]+#>\s*<#[\d.]+#>/g, function(match) {
        const nums = match.match(/[\d.]+/g);
        const max = Math.max(...nums.map(Number));
        return `<#${max}#>`;
    });

    return result;
}

// Edge TTS：调用 CF Worker 获取 MP3 blob URL
async function playEdgeTts(text, voiceId, emotion = 'neutral') {
    const tts = appData.ttsSettings;
    if (!tts.edgeWorkerUrl) throw new Error('Edge TTS Worker 地址未配置');

    // Edge TTS不支持真正的情绪风格，始终使用neutral参数避免奇怪的变调
    const params = EDGE_EMOTION_PARAMS.neutral;
    const cacheKey = `edge|${voiceId}|neutral|${text}`;

    if (ttsCache.has(cacheKey)) {
        return { url: ttsCache.get(cacheKey), cacheKey };
    }

    const url = tts.edgeWorkerUrl.replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (tts.edgeWorkerKey) {
        headers['Authorization'] = 'Bearer ' + tts.edgeWorkerKey;
    }

    console.log('Edge TTS 请求:', url, voiceId);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
                text,
                voice: voiceId,
                rate: params.rate,
                pitch: params.pitch,
                volume: params.volume
            })
        });
    } catch(e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') throw new Error('Edge TTS 请求超时 (15s)');
        throw new Error('Edge TTS 网络错误: ' + e.message);
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
        let errMsg = 'Edge TTS 请求失败: HTTP ' + response.status;
        try {
            const errData = await response.json();
            if (errData.error) errMsg = errData.error;
        } catch(e) {}
        throw new Error(errMsg);
    }

    const blob = await response.blob();
    console.log('Edge TTS 收到音频:', blob.size, 'bytes');
    const blobUrl = URL.createObjectURL(blob);
    ttsCache.set(cacheKey, blobUrl);
    return { url: blobUrl, cacheKey };
}

// 获取当前微信对话是否开启了情绪映射
function isEmotionEnabled() {
    const conv = wechatData.conversations?.[wechatData.currentAssistantId];
    return conv?.settings?.emotionEnabled !== false; // 默认开启
}

// 调用MiniMax TTS API（支持情绪参数）
async function playTtsAudio(text, voiceId, el, emotion = 'neutral') {
    const tts = appData.ttsSettings;

    // 情绪映射开关：关闭时不传情绪给MiniMax
    if (!isEmotionEnabled()) emotion = 'neutral';

    // 在用户手势调用栈中预解锁Audio元素（必须在任何await之前）
    // Safari要求play()在用户手势中，async fetch之后手势上下文会丢失
    const unlockedAudio = preUnlockAudioElement();

    // Edge TTS 路径
    if (tts.engine === 'edge') {
        if (!tts.edgeWorkerUrl) return;
        resetAudioRoute();
        await new Promise(r => setTimeout(r, 100));
        if (el) el.style.opacity = '0.5';
        const edgeText = stripInterjectionsAlways(text);
        try {
            const { url: audioUrl } = await playEdgeTts(edgeText, voiceId, emotion);
            if (currentTtsAudio && currentTtsAudio !== unlockedAudio) { currentTtsAudio.pause(); currentTtsAudio = null; }
            unlockedAudio.src = audioUrl;
            currentTtsAudio = unlockedAudio;
            await currentTtsAudio.play();
        } catch (e) {
            console.error('Edge TTS播放失败:', e);
            alert('语音播放失败: ' + e.message);
        } finally {
            if (el) el.style.opacity = '1';
        }
        return;
    }

    // MiniMax 路径
    if (!tts.groupId || !tts.apiKey) return;

    // 每次TTS播放前重置音频路由（防止语音识别后外放）
    resetAudioRoute();
    // 给音频路由一点时间重置
    await new Promise(r => setTimeout(r, 100));

    // 标准化情绪 + 去除不兼容的拟声词 + 自然停顿
    const normalizedEmotion = normalizeEmotion(emotion);
    const cleanText = stripInterjections(text);
    const processedText = addNaturalPauses(cleanText);

    const cacheKey = `${voiceId}|${tts.model}|${normalizedEmotion}|${text}`;

    // 先检查缓存
    if (ttsCache.has(cacheKey)) {
        const cachedUrl = ttsCache.get(cacheKey);
        if (currentTtsAudio && currentTtsAudio !== unlockedAudio) {
            currentTtsAudio.pause();
            currentTtsAudio = null;
        }
        unlockedAudio.src = cachedUrl;
        currentTtsAudio = unlockedAudio;
        try {
            await currentTtsAudio.play();
        } catch (e) {
            console.error('缓存音频播放失败:', e);
        }
        return;
    }

    // 显示加载状态
    if (el) el.style.opacity = '0.5';

    try {
        const minimaxBody = {
            model: tts.model,
            text: processedText,
            stream: false,
            output_format: "url",
            voice_setting: {
                voice_id: voiceId,
                speed: 1.0,
                vol: 1.0,
                pitch: 0,
                emotion: normalizedEmotion
            },
            audio_setting: {
                sample_rate: 32000,
                bitrate: 128000,
                format: 'mp3',
                channel: 1
            }
        };

        let response;
        if (tts.minimaxWorkerUrl) {
            const workerUrl = tts.minimaxWorkerUrl.replace(/\/+$/, '');
            const workerHeaders = { 'Content-Type': 'application/json' };
            if (tts.minimaxWorkerKey) {
                workerHeaders['Authorization'] = 'Bearer ' + tts.minimaxWorkerKey;
            }
            response = await fetch(workerUrl, {
                method: 'POST',
                headers: workerHeaders,
                body: JSON.stringify({
                    groupId: tts.groupId,
                    apiKey: tts.apiKey,
                    domain: tts.domain,
                    requestBody: minimaxBody
                })
            });
        } else {
            response = await fetch(`https://${tts.domain}/v1/text_to_speech?GroupId=${tts.groupId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + tts.apiKey
                },
                body: JSON.stringify(minimaxBody)
            });
        }

        if (!response.ok) {
            throw new Error('TTS请求失败: HTTP ' + response.status);
        }

        const data = await response.json();

        // 检查是否拿到音频URL
        const audioUrl = data?.data?.audio;
        if (!audioUrl) {
            const msg = data?.base_resp?.status_msg || '未拿到audio字段';
            throw new Error(msg);
        }

        // 存入缓存
        ttsCache.set(cacheKey, audioUrl);

        // 停掉上一个音频
        if (currentTtsAudio && currentTtsAudio !== unlockedAudio) {
            currentTtsAudio.pause();
            currentTtsAudio.src = '';
            currentTtsAudio = null;
        }

        // 用预解锁的Audio元素播放（避免Safari NotAllowedError）
        unlockedAudio.src = audioUrl;
        unlockedAudio.preload = 'auto';
        currentTtsAudio = unlockedAudio;

        await currentTtsAudio.play();

    } catch (error) {
        console.error('语音播放失败:', error);
    } finally {
        if (el) el.style.opacity = '1';
    }
}

// 带回调的TTS播放函数（支持情绪参数）
async function playTtsAudioWithCallback(text, voiceId, onStart, onEnd, emotion = 'neutral', preUnlockedAudio = null) {
    const tts = appData.ttsSettings;
    console.log('TTS引擎:', tts.engine, '| voiceId:', voiceId);

    // 情绪映射开关：关闭时不传情绪给MiniMax
    if (!isEmotionEnabled()) emotion = 'neutral';

    // 在用户手势调用栈中预解锁Audio元素（必须在任何await之前）
    if (!preUnlockedAudio) {
        preUnlockedAudio = preUnlockAudioElement();
    }

    // 安全播放函数
    async function safePlay(audio) {
        try {
            await audio.play();
        } catch (e) {
            if (e.name === 'NotAllowedError') {
                console.warn('首次播放被阻止，尝试重试...');
                await new Promise(r => setTimeout(r, 100));
                await audio.play();
            } else {
                throw e;
            }
        }
    }

    // Edge TTS 路径
    if (tts.engine === 'edge') {
        if (!tts.edgeWorkerUrl) throw new Error('Edge TTS Worker 地址未配置');

        resetAudioRoute();
        await new Promise(r => setTimeout(r, 100));

        const edgeText = stripInterjectionsAlways(text);
        const { url: audioUrl } = await playEdgeTts(edgeText, voiceId, emotion);

        if (currentTtsAudio && currentTtsAudio !== preUnlockedAudio) {
            currentTtsAudio.pause();
            currentTtsAudio.src = '';
            currentTtsAudio = null;
        }

        preUnlockedAudio.src = audioUrl;
        preUnlockedAudio.preload = 'auto';
        currentTtsAudio = preUnlockedAudio;
        if (onStart) onStart();
        currentTtsAudio.onended = () => { if (onEnd) onEnd(); };
        await safePlay(currentTtsAudio);
        return;
    }

    // MiniMax 路径
    if (!tts.groupId || !tts.apiKey) {
        throw new Error('TTS未配置');
    }

    // 每次TTS播放前重置音频路由（防止语音识别后外放）
    resetAudioRoute();
    // 给音频路由一点时间重置
    await new Promise(r => setTimeout(r, 100));

    // 标准化情绪 + 去除不兼容的拟声词 + 自然停顿
    const normalizedEmotion = normalizeEmotion(emotion);
    const cleanText = stripInterjections(text);
    const processedText = addNaturalPauses(cleanText);

    const cacheKey = `${voiceId}|${tts.model}|${normalizedEmotion}|${text}`;

    // 先检查缓存
    if (ttsCache.has(cacheKey)) {
        const cachedUrl = ttsCache.get(cacheKey);
        if (currentTtsAudio && currentTtsAudio !== preUnlockedAudio) {
            currentTtsAudio.pause();
            currentTtsAudio = null;
        }
        preUnlockedAudio.src = cachedUrl;
        currentTtsAudio = preUnlockedAudio;
        if (onStart) onStart();
        currentTtsAudio.onended = () => { if (onEnd) onEnd(); };
        await safePlay(currentTtsAudio);
        return;
    }

    // 请求TTS（优先走Worker代理，fallback直连）
    const minimaxRequestBody = {
        model: tts.model,
        text: processedText,
        stream: false,
        output_format: "url",
        voice_setting: {
            voice_id: voiceId,
            speed: 1.0,
            vol: 1.0,
            pitch: 0,
            emotion: normalizedEmotion
        },
        audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: 'mp3',
            channel: 1
        }
    };

    let response;
    if (tts.minimaxWorkerUrl) {
        // 走Worker代理
        const workerUrl = tts.minimaxWorkerUrl.replace(/\/+$/, '');
        const workerHeaders = { 'Content-Type': 'application/json' };
        if (tts.minimaxWorkerKey) {
            workerHeaders['Authorization'] = 'Bearer ' + tts.minimaxWorkerKey;
        }
        response = await fetch(workerUrl, {
            method: 'POST',
            headers: workerHeaders,
            body: JSON.stringify({
                groupId: tts.groupId,
                apiKey: tts.apiKey,
                domain: tts.domain,
                requestBody: minimaxRequestBody
            })
        });
    } else {
        // 直连MiniMax（可能有CORS限制）
        const ttsUrl = `https://${tts.domain}/v1/text_to_speech?GroupId=${tts.groupId}`;
        response = await fetch(ttsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + tts.apiKey
            },
            body: JSON.stringify(minimaxRequestBody)
        });
    }

    if (!response.ok) {
        const errText = await response.text().catch(() => '无法读取响应体');
        console.error('TTS请求失败，响应体:', errText);
        throw new Error('TTS请求失败: HTTP ' + response.status + ' | ' + errText);
    }

    const data = await response.json();
    console.log('TTS响应:', JSON.stringify(data).substring(0, 500));
    const audioUrl = data?.data?.audio;
    if (!audioUrl) {
        console.error('TTS完整响应:', JSON.stringify(data));
        throw new Error(data?.base_resp?.status_msg || '未拿到audio字段');
    }

    // 存入缓存
    ttsCache.set(cacheKey, audioUrl);

    // 停掉上一个音频
    if (currentTtsAudio && currentTtsAudio !== preUnlockedAudio) {
        currentTtsAudio.pause();
        currentTtsAudio.src = '';
        currentTtsAudio = null;
    }

    // 用预解锁的Audio元素播放（避免Safari NotAllowedError）
    preUnlockedAudio.src = audioUrl;
    preUnlockedAudio.preload = 'auto';
    currentTtsAudio = preUnlockedAudio;
    if (onStart) onStart();
    currentTtsAudio.onended = () => { if (onEnd) onEnd(); };
    await safePlay(currentTtsAudio);
}

// TTS设置相关函数
function toggleTtsEngineFields() {
    const engine = document.getElementById('ttsEngine').value;
    document.getElementById('ttsMinimaxFields').style.display = engine === 'minimax' ? '' : 'none';
    document.getElementById('ttsEdgeFields').style.display = engine === 'edge' ? '' : 'none';
}

function openTtsSettings() {
    const tts = appData.ttsSettings || {};
    document.getElementById('ttsEngine').value = tts.engine || 'minimax';
    document.getElementById('ttsGroupId').value = tts.groupId || '';
    document.getElementById('ttsApiKey').value = tts.apiKey || '';
    document.getElementById('ttsModel').value = tts.model || 'speech-02-hd';
    document.getElementById('ttsDomain').value = tts.domain || 'api.minimax.chat';
    document.getElementById('ttsEdgeWorkerUrl').value = tts.edgeWorkerUrl || '';
    document.getElementById('ttsEdgeWorkerKey').value = tts.edgeWorkerKey || '';
    document.getElementById('ttsMinimaxWorkerUrl').value = tts.minimaxWorkerUrl || '';
    document.getElementById('ttsMinimaxWorkerKey').value = tts.minimaxWorkerKey || '';
    toggleTtsEngineFields();
    showModal('ttsSettingsModal');
}

function saveTtsSettings() {
    appData.ttsSettings = {
        engine: document.getElementById('ttsEngine').value,
        groupId: document.getElementById('ttsGroupId').value.trim(),
        apiKey: document.getElementById('ttsApiKey').value.trim(),
        model: document.getElementById('ttsModel').value,
        domain: document.getElementById('ttsDomain').value,
        edgeWorkerUrl: document.getElementById('ttsEdgeWorkerUrl').value.trim(),
        edgeWorkerKey: document.getElementById('ttsEdgeWorkerKey').value.trim(),
        minimaxWorkerUrl: document.getElementById('ttsMinimaxWorkerUrl').value.trim(),
        minimaxWorkerKey: document.getElementById('ttsMinimaxWorkerKey').value.trim()
    };
    saveData();
    updateTtsStatus();
    hideModal('ttsSettingsModal');
}

function isTtsConfigured() {
    const tts = appData.ttsSettings;
    if (!tts) return false;
    if (tts.engine === 'edge') return !!tts.edgeWorkerUrl;
    return !!(tts.groupId && tts.apiKey);
}

function updateTtsStatus() {
    const tts = appData.ttsSettings;
    const statusEl = document.getElementById('ttsStatus');
    if (statusEl) {
        statusEl.textContent = isTtsConfigured() ? '已配置' : '未配置';
    }
}

// Edge TTS 音色下拉框填充（通用）
function populateEdgeVoiceSelect(selectId, genderId, currentVoiceId) {
    const gender = document.getElementById(genderId).value;
    const select = document.getElementById(selectId);
    const voices = EDGE_TTS_VOICES[gender] || [];
    select.innerHTML = voices.map(v =>
        `<option value="${v.id}" ${v.id === currentVoiceId ? 'selected' : ''}>${v.name}</option>`
    ).join('');
}

// 根据 voiceId 判断性别
function getEdgeVoiceGender(voiceId) {
    if (EDGE_TTS_VOICES.male.some(v => v.id === voiceId)) return 'male';
    return 'female';
}

// 微信设置 Edge 音色联动
function updateWechatEdgeVoiceOptions() {
    populateEdgeVoiceSelect('wechatEdgeVoice', 'wechatEdgeGender');
}

// 语音通话设置 Edge 音色联动
function updateVcEdgeVoiceOptions() {
    populateEdgeVoiceSelect('vcEdgeVoice', 'vcEdgeGender');
}

// 根据引擎切换音色 UI 显隐
function toggleVoiceIdFields() {
    const isEdge = appData.ttsSettings.engine === 'edge';
    const wechatVoiceIdRow = document.getElementById('wechatVoiceIdRow');
    const wechatEdgeRow = document.getElementById('wechatEdgeVoiceRow');
    if (wechatVoiceIdRow) wechatVoiceIdRow.style.display = isEdge ? 'none' : '';
    if (wechatEdgeRow) wechatEdgeRow.style.display = isEdge ? '' : 'none';

    const vcVoiceIdRow = document.getElementById('vcVoiceIdRow');
    const vcEdgeRow = document.getElementById('vcEdgeVoiceRow');
    if (vcVoiceIdRow) vcVoiceIdRow.style.display = isEdge ? 'none' : '';
    if (vcEdgeRow) vcEdgeRow.style.display = isEdge ? '' : 'none';
}
