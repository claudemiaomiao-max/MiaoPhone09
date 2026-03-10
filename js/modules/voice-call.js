/**
 * 语音通话模式
 *
 * 负责：通讯录/拨号/通话/讯飞STT/TTS/录音保存/日历记录/详情播放
 * 暴露函数：loadVoiceCallData, saveVoiceCallData, openVoiceCallMode,
 *           saveVoiceCallAudio, loadVoiceCallAudio
 * 依赖：appData(data.js), saveToIndexedDB/loadFromIndexedDB(storage.js),
 *        openPage/closePage(navigation.js), escapeHtml(ui.js),
 *        playTtsAudioWithCallback/preUnlockAudioElement(tts.js),
 *        mlabSearchNarratives(memory-lab.js),
 *        xfFloat32ToInt16/xfArrayBufferToBase64(stt.js),
 *        initWechatData(wechat-core.js), _cloudSyncDirty(cloud-sync.js),
 *        dbInstance(storage.js), currentTtsAudio(tts.js)
 */

        // ==================== 语音通话模式 ====================
        let voiceCallData = {
            settings: {
                autoSend: true,
                autoSendDelay: 2,
                carryWechatContext: false,
                contextCount: 30,
                voiceId: ''
            },
            records: []
        };

        // 通话状态
        let vcState = {
            assistantId: null,
            assistant: null,
            messages: [],       // 当前通话消息 [{role, content, emotion}]
            recognition: null,  // SpeechRecognition 实例
            audioContext: null,  // Web Audio API
            analyser: null,
            micStream: null,
            timerInterval: null,
            timerSeconds: 0,
            startTime: null,
            isProcessing: false, // 正在等待AI回复
            autoSendTimeout: null,
            waveformInterval: null,
            pendingText: '',
            processedCount: 0
        };

        // 日历状态
        let vcCalendarYear = new Date().getFullYear();
        let vcCalendarMonth = new Date().getMonth();
        let vcSelectedDate = null;
        let vcDetailRecords = [];
        let vcDetailIndex = 0;

        let _voiceCallDataLoaded = false;

        // 加载/保存语音通话数据
        async function loadVoiceCallData() {
            if (dbInstance) {
                const saved = await loadFromIndexedDB('voiceCallData');
                if (saved) {
                    voiceCallData = { ...voiceCallData, ...saved };
                    _voiceCallDataLoaded = true;
                    return;
                }
            }
            const saved = localStorage.getItem('miaomiao_voicecall_v1');
            if (saved) {
                voiceCallData = { ...voiceCallData, ...JSON.parse(saved) };
            }
            _voiceCallDataLoaded = true;
        }

        function saveVoiceCallData() {
            if (!_voiceCallDataLoaded) {
                console.warn('语音通话数据尚未加载完成，跳过保存以防覆盖');
                return;
            }
            if (dbInstance) {
                saveToIndexedDB('voiceCallData', voiceCallData).then(success => {
                    if (!success) {
                        try { localStorage.setItem('miaomiao_voicecall_v1', JSON.stringify(voiceCallData)); } catch(e) {}
                    }
                });
                _cloudSyncDirty.voiceCallData = true;
                return;
            }
            try { localStorage.setItem('miaomiao_voicecall_v1', JSON.stringify(voiceCallData)); } catch(e) {}
            _cloudSyncDirty.voiceCallData = true;
        }

        // 保存音频Blob到IndexedDB
        function saveVoiceCallAudio(key, blob) {
            return new Promise((resolve) => {
                if (!dbInstance) { resolve(false); return; }
                try {
                    const tx = dbInstance.transaction(['voiceCallAudio'], 'readwrite');
                    const store = tx.objectStore('voiceCallAudio');
                    store.put({ id: key, data: blob });
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                } catch(e) { resolve(false); }
            });
        }

        function loadVoiceCallAudio(key) {
            return new Promise((resolve) => {
                if (!dbInstance) { resolve(null); return; }
                try {
                    const tx = dbInstance.transaction(['voiceCallAudio'], 'readonly');
                    const store = tx.objectStore('voiceCallAudio');
                    const req = store.get(key);
                    req.onsuccess = () => resolve(req.result?.data || null);
                    req.onerror = () => resolve(null);
                } catch(e) { resolve(null); }
            });
        }

        // ---- 打开语音通话模式 ----
        async function openVoiceCallMode() {
            await loadVoiceCallData();
            await initWechatData();  // 确保微信聊天数据已加载（语音通话可能携带微信上下文）
            renderVcContactList();
            openPage('voiceCallPage');
        }

        // ---- 渲染通讯录 ----
        function renderVcContactList() {
            const list = document.getElementById('vcContactList');
            const assistants = appData.assistants || [];
            if (assistants.length === 0) {
                list.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">暂无助手，请先在设置中添加</div>';
                return;
            }
            list.innerHTML = assistants.map(a => {
                const avatarHtml = a.avatar
                    ? `<img src="${a.avatar}" alt="">`
                    : a.name?.charAt(0) || '?';
                return `<div class="vc-contact-item" onclick="showVcDialConfirm('${a.id}')">
                    <div class="vc-contact-avatar">${avatarHtml}</div>
                    <div class="vc-contact-name">${a.name || '未命名助手'}</div>
                </div>`;
            }).join('');
        }

        // ---- 拨号确认 ----
        function showVcDialConfirm(assistantId) {
            const assistant = appData.assistants.find(a => a.id === assistantId);
            if (!assistant) return;
            vcState.assistantId = assistantId;
            vcState.assistant = assistant;

            const avatarEl = document.getElementById('vcDialAvatar');
            avatarEl.innerHTML = assistant.avatar
                ? `<img src="${assistant.avatar}" alt="">`
                : assistant.name?.charAt(0) || '?';
            document.getElementById('vcDialName').textContent = assistant.name || '未命名助手';
            document.getElementById('vcDialModal').classList.add('show');
        }

        function closeVcDialModal() {
            document.getElementById('vcDialModal').classList.remove('show');
        }

        // ---- 开始通话 ----
        // 预解锁的Audio对象，用于绕过Safari自动播放限制
        let vcUnlockedAudio = null;

        function startVoiceCall() {
            closeVcDialModal();
            const assistant = vcState.assistant;

            // 在用户交互事件中预解锁Audio（Safari要求音频播放必须由用户手势触发）
            // 播放一段极短的静音来"解锁"，后续就可以自动播放了
            try {
                vcUnlockedAudio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==');
                vcUnlockedAudio.play().then(() => {
                    console.log('音频播放权限已解锁');
                }).catch(e => {
                    console.warn('音频解锁失败:', e);
                });
            } catch(e) {
                console.warn('创建解锁Audio失败:', e);
            }

            // 显示拨号动画
            const dialAvatar = document.getElementById('vcDialingAvatar');
            dialAvatar.innerHTML = assistant.avatar
                ? `<img src="${assistant.avatar}" alt="">`
                : assistant.name?.charAt(0) || '?';
            document.getElementById('vcDialingName').textContent = assistant.name;
            openPage('voiceCallDialingPage');

            // 初始化通话状态
            vcState.messages = [];
            vcState.timerSeconds = 0;
            vcState.startTime = new Date();
            vcState.isProcessing = false;
            vcState.pendingText = '';
            vcState.processedCount = 0;

            // 设置通话界面
            document.getElementById('vcActiveName').textContent = assistant.name;
            document.getElementById('vcActiveTimer').textContent = '00:00';
            document.getElementById('vcMessages').innerHTML = '';
            document.getElementById('vcInput').value = '';

            // 非自动发送模式显示发送按钮
            const sendBtn = document.getElementById('vcSendBtn');
            sendBtn.style.display = voiceCallData.settings.autoSend ? 'none' : 'flex';

            // 延迟进入通话界面（拨号动画至少2秒）
            setTimeout(() => {
                closePage('voiceCallDialingPage');
                openPage('voiceCallActivePage');
                startVcTimer();
                startVcRecognition();
                startVcWaveform();
            }, 2500);

            // 输入框自动伸缩（textarea）
            const vcInputEl = document.getElementById('vcInput');
            vcInputEl.addEventListener('input', vcAutoResize);
        }

        // 输入框自动调整高度（1-4行）
        function vcAutoResize() {
            const el = document.getElementById('vcInput');
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 84) + 'px';
            el.scrollTop = el.scrollHeight;
        }

        // ---- 通话计时器 ----
        function startVcTimer() {
            vcState.timerSeconds = 0;
            vcState.timerInterval = setInterval(() => {
                vcState.timerSeconds++;
                const m = String(Math.floor(vcState.timerSeconds / 60)).padStart(2, '0');
                const s = String(vcState.timerSeconds % 60).padStart(2, '0');
                document.getElementById('vcActiveTimer').textContent = `${m}:${s}`;
            }, 1000);
        }

        function stopVcTimer() {
            if (vcState.timerInterval) {
                clearInterval(vcState.timerInterval);
                vcState.timerInterval = null;
            }
        }

        // ---- 声纹效果 ----
        function startVcWaveform() {
            try {
                navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                    vcState.micStream = stream;
                    const AudioCtx = window.AudioContext || window.webkitAudioContext;
                    vcState.audioContext = new AudioCtx();
                    vcState.analyser = vcState.audioContext.createAnalyser();
                    vcState.analyser.fftSize = 64;
                    const source = vcState.audioContext.createMediaStreamSource(stream);
                    source.connect(vcState.analyser);

                    const bars = document.querySelectorAll('#vcWaveform .vc-waveform-bar');
                    const dataArray = new Uint8Array(vcState.analyser.frequencyBinCount);

                    vcState.waveformInterval = setInterval(() => {
                        vcState.analyser.getByteFrequencyData(dataArray);
                        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                        bars.forEach((bar, i) => {
                            const val = dataArray[i * 2] || 0;
                            const height = Math.max(6, (val / 255) * 32);
                            bar.style.height = height + 'px';
                        });
                        // 有声音时显示active
                        const waveform = document.getElementById('vcWaveform');
                        if (avg > 20) {
                            waveform.classList.add('active');
                        } else {
                            waveform.classList.remove('active');
                        }
                    }, 80);
                }).catch(err => {
                    console.warn('麦克风访问失败:', err);
                });
            } catch(e) {
                console.warn('Web Audio API不可用:', e);
            }
        }

        function stopVcWaveform() {
            if (vcState.waveformInterval) {
                clearInterval(vcState.waveformInterval);
                vcState.waveformInterval = null;
            }
            if (vcState.micStream) {
                vcState.micStream.getTracks().forEach(t => t.stop());
                vcState.micStream = null;
            }
            if (vcState.audioContext) {
                vcState.audioContext.close().catch(() => {});
                vcState.audioContext = null;
            }
        }

        // ---- 语音识别（讯飞优先，降级 Web Speech API） ----
        let vcXfWs = null;
        let vcXfAudioCtx = null;
        let vcXfMicStream = null;
        let vcXfProcessor = null;
        let vcXfSource = null;
        let vcXfResults = {};
        let vcXfLastFullText = '';

        function startVcRecognition() {
            if (appData.settings.backendUrl) {
                startVcXfRecognition();
            } else {
                startVcWebSpeechRecognition();
            }
        }

        function stopVcRecognition() {
            clearTimeout(vcState.autoSendTimeout);
            if (vcState.recognition?.type === 'xfyun') {
                vcXfCleanupAll();
            } else if (vcState.recognition) {
                vcState.recognition.onend = null;
                vcState.recognition.stop();
            }
            vcState.recognition = null;
            const micBtn = document.getElementById('vcMicBtn');
            if (micBtn) micBtn.classList.remove('recording');
        }

        // 麦克风按钮切换
        function toggleVcMic() {
            if (vcState.isProcessing) return;
            if (vcState.recognition) {
                stopVcRecognition();
            } else {
                startVcRecognition();
            }
        }

        // ---- 讯飞 STT（语音通话用） ----
        async function startVcXfRecognition() {
            vcXfResults = {};
            vcXfLastFullText = '';
            vcState.pendingText = '';
            vcState.processedCount = 0;

            const micBtn = document.getElementById('vcMicBtn');
            if (micBtn) micBtn.classList.add('recording');

            try {
                const backendUrl = appData.settings.backendUrl;
                console.log('语音通话：请求讯飞签名...');
                const signResp = await fetch(`${backendUrl}/api/stt-sign`);
                if (!signResp.ok) throw new Error('签名请求失败: ' + signResp.status);
                const { url, appid } = await signResp.json();

                vcXfMicStream = await navigator.mediaDevices.getUserMedia({
                    audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
                });

                vcXfAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                vcXfSource = vcXfAudioCtx.createMediaStreamSource(vcXfMicStream);
                vcXfProcessor = vcXfAudioCtx.createScriptProcessor(4096, 1, 1);

                vcXfWs = new WebSocket(url);
                let frameCount = 0;

                vcXfWs.onopen = () => {
                    console.log('语音通话：讯飞已连接');
                    vcState.recognition = { type: 'xfyun' };

                    vcXfProcessor.onaudioprocess = (e) => {
                        if (!vcXfWs || vcXfWs.readyState !== WebSocket.OPEN) return;

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

                        vcXfWs.send(JSON.stringify(frame));
                        frameCount++;
                    };

                    vcXfSource.connect(vcXfProcessor);
                    vcXfProcessor.connect(vcXfAudioCtx.destination);
                };

                vcXfWs.onmessage = (event) => {
                    try {
                        const resp = JSON.parse(event.data);
                        if (resp.code !== 0) {
                            console.error('语音通话：讯飞识别错误:', resp.code, resp.message);
                            return;
                        }
                        vcXfParseResult(resp);
                    } catch (e) {
                        console.error('语音通话：讯飞消息解析失败:', e);
                    }
                };

                vcXfWs.onclose = () => {
                    console.log('语音通话：讯飞连接关闭');
                    // 合并剩余结果
                    const keys = Object.keys(vcXfResults).map(Number).sort((a, b) => a - b);
                    const remainText = keys.map(k => vcXfResults[k]).join('');
                    if (remainText) vcState.pendingText += remainText;
                    vcXfResults = {};

                    vcXfCleanupAudio();

                    const isActive = document.getElementById('voiceCallActivePage').classList.contains('active');
                    if (!isActive || !vcState.recognition?.type) return;

                    if (voiceCallData.settings.autoSend) {
                        // 自动发送模式：60秒到了，有文字就发出去
                        if (vcState.pendingText.trim()) {
                            clearTimeout(vcState.autoSendTimeout);
                            const text = vcState.pendingText.trim();
                            vcState.pendingText = '';
                            document.getElementById('vcInput').value = '';
                            vcAutoResize();
                            vcState.recognition = null;
                            const micBtn = document.getElementById('vcMicBtn');
                            if (micBtn) micBtn.classList.remove('recording');
                            vcSendUserMessage(text);
                        } else {
                            // 没文字，自动重连继续听
                            vcState.recognition = null;
                            setTimeout(() => {
                                if (isActive && !vcState.isProcessing) startVcXfRecognition();
                            }, 300);
                        }
                    } else {
                        // 手动发送模式：60秒到了就停，图标变灰
                        vcState.recognition = null;
                        const micBtn = document.getElementById('vcMicBtn');
                        if (micBtn) micBtn.classList.remove('recording');
                        console.log('语音通话：讯飞60秒到期，点击麦克风可继续');
                    }
                };

                vcXfWs.onerror = (e) => {
                    console.error('语音通话：讯飞错误:', e);
                    vcXfCleanupAll();
                    vcState.recognition = null;
                    console.log('语音通话：讯飞不可用，降级到浏览器语音识别');
                    startVcWebSpeechRecognition();
                };

            } catch (e) {
                console.error('语音通话：讯飞启动失败:', e);
                vcXfCleanupAll();
                vcState.recognition = null;
                console.log('语音通话：讯飞启动失败，降级到浏览器语音识别');
                startVcWebSpeechRecognition();
            }
        }

        // 解析语音通话讯飞识别结果
        function vcXfParseResult(resp) {
            if (vcState.isProcessing) return;

            const result = resp.data?.result;
            if (!result) return;

            const sn = result.sn;
            const pgs = result.pgs;

            let text = '';
            if (result.ws) {
                result.ws.forEach(w => { w.cw.forEach(c => { text += c.w; }); });
            }

            if (pgs === 'rpl' && result.rg) {
                for (let i = result.rg[0]; i <= result.rg[1]; i++) {
                    if (i !== sn) delete vcXfResults[i];
                }
            }

            vcXfResults[sn] = text;

            const keys = Object.keys(vcXfResults).map(Number).sort((a, b) => a - b);
            const fullText = keys.map(k => vcXfResults[k]).join('');

            const display = vcState.pendingText + fullText;
            document.getElementById('vcInput').value = display;
            vcAutoResize();

            // 自动发送模式：文字变化时重置沉默计时器
            if (voiceCallData.settings.autoSend && fullText !== vcXfLastFullText) {
                vcXfLastFullText = fullText;
                clearTimeout(vcState.autoSendTimeout);
                if (display.trim()) {
                    vcState.autoSendTimeout = setTimeout(() => {
                        if (vcState.recognition?.type === 'xfyun' && !vcState.isProcessing) {
                            const textToSend = (vcState.pendingText + fullText).trim();
                            vcState.pendingText = '';
                            vcXfResults = {};
                            vcXfLastFullText = '';
                            document.getElementById('vcInput').value = '';
                            vcAutoResize();
                            stopVcRecognition();
                            vcSendUserMessage(textToSend);
                        }
                    }, (voiceCallData.settings.autoSendDelay || 2) * 1000);
                }
            }

            // 最终结果合入 pendingText
            if (resp.data.status === 2) {
                vcState.pendingText += fullText;
                vcXfResults = {};
                vcXfLastFullText = '';
            }
        }

        // 清理语音通话讯飞音频资源
        function vcXfCleanupAudio() {
            if (vcXfProcessor) { vcXfProcessor.onaudioprocess = null; vcXfProcessor.disconnect(); vcXfProcessor = null; }
            if (vcXfSource) { vcXfSource.disconnect(); vcXfSource = null; }
            if (vcXfAudioCtx) { vcXfAudioCtx.close().catch(() => {}); vcXfAudioCtx = null; }
            if (vcXfMicStream) { vcXfMicStream.getTracks().forEach(t => t.stop()); vcXfMicStream = null; }
        }

        function vcXfCleanupAll() {
            if (vcXfWs) {
                if (vcXfWs.readyState === WebSocket.OPEN) {
                    try { vcXfWs.send(JSON.stringify({ data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' } })); } catch(e) {}
                }
                vcXfWs.onclose = null; vcXfWs.onerror = null; vcXfWs.onmessage = null;
                vcXfWs.close(); vcXfWs = null;
            }
            vcXfCleanupAudio();
            vcXfResults = {};
            vcXfLastFullText = '';
        }

        // ---- Web Speech API（语音通话降级方案） ----
        function startVcWebSpeechRecognition() {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                alert('您的浏览器不支持语音识别');
                return;
            }

            const recognition = new SpeechRecognition();
            recognition.lang = 'zh-CN';
            recognition.continuous = true;
            recognition.interimResults = true;
            vcState.recognition = recognition;

            const micBtn = document.getElementById('vcMicBtn');
            if (micBtn) micBtn.classList.add('recording');

            recognition.onresult = (event) => {
                if (vcState.isProcessing) return;

                let interim = '';
                let finalText = '';
                for (let i = vcState.processedCount; i < event.results.length; i++) {
                    if (event.results[i].isFinal) {
                        finalText += event.results[i][0].transcript;
                        vcState.processedCount = i + 1;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }

                if (finalText) {
                    vcState.pendingText += finalText;
                }

                const display = vcState.pendingText + interim;
                document.getElementById('vcInput').value = display;
                vcAutoResize();

                if (voiceCallData.settings.autoSend && finalText) {
                    clearTimeout(vcState.autoSendTimeout);
                    vcState.autoSendTimeout = setTimeout(() => {
                        if (vcState.pendingText.trim()) {
                            vcSendUserMessage(vcState.pendingText.trim());
                            vcState.pendingText = '';
                            document.getElementById('vcInput').value = '';
                            vcAutoResize();
                        }
                    }, (voiceCallData.settings.autoSendDelay || 2) * 1000);
                }
            };

            recognition.onerror = (event) => {
                console.warn('语音识别错误:', event.error);
                if (event.error === 'no-speech' || event.error === 'aborted') {
                    setTimeout(() => {
                        if (vcState.recognition && !vcState.recognition.type) {
                            try { vcState.recognition.start(); } catch(e) {}
                        }
                    }, 500);
                }
            };

            recognition.onend = () => {
                if (document.getElementById('voiceCallActivePage').classList.contains('active')) {
                    setTimeout(() => {
                        if (vcState.recognition && !vcState.recognition.type) {
                            try {
                                vcState.processedCount = 0;
                                vcState.recognition.start();
                            } catch(e) {}
                        }
                    }, 300);
                }
            };

            recognition.start();
        }

        // ---- 手动发送 ----
        function vcManualSend() {
            const input = document.getElementById('vcInput');
            const text = input.value.trim();
            if (!text || vcState.isProcessing) return;
            // 发送时自动断开识别
            stopVcRecognition();
            vcState.pendingText = '';
            vcState.processedCount = 0;
            input.value = '';
            vcAutoResize();
            vcSendUserMessage(text);
        }

        // ---- 发送消息并获取AI回复 ----
        async function vcSendUserMessage(text) {
            if (vcState.isProcessing) return;
            vcState.isProcessing = true;

            // 暂停语音识别
            if (vcState.recognition) {
                try { vcState.recognition.stop(); } catch(e) {}
            }

            // 添加用户消息
            vcState.messages.push({ role: 'user', content: text });
            vcRenderMessages();

            // 显示loading
            const loadingId = 'vc-loading-' + Date.now();
            const messagesEl = document.getElementById('vcMessages');
            const loadingDiv = document.createElement('div');
            loadingDiv.id = loadingId;
            loadingDiv.className = 'vc-msg vc-msg-assistant vc-msg-loading';
            loadingDiv.innerHTML = '<div class="vc-dots"><span></span><span></span><span></span></div>';
            messagesEl.appendChild(loadingDiv);
            messagesEl.scrollTop = messagesEl.scrollHeight;

            try {
                // 获取模型配置：助手默认模型 > 全局默认模型
                const assistant = vcState.assistant;
                const assistantModel = assistant?.providerId && assistant?.modelId ? `${assistant.providerId}||${assistant.modelId}` : '';
                const globalModel = appData.settings.defaultModel;
                const modelValue = assistantModel || globalModel;
                if (!modelValue) throw new Error('请先在设置中选择默认模型');
                const [providerId, modelId] = modelValue.split('||');
                const provider = appData.providers.find(p => p.id === providerId);
                if (!provider) throw new Error('找不到供应商配置');

                // 构建请求
                const requestMessages = await buildVcRequestMessages();
                const requestBody = {
                    model: modelId,
                    messages: requestMessages,
                    temperature: vcState.assistant.temperature || 0.8
                };

                const response = await fetch(provider.baseUrl + provider.apiPath, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + provider.apiKey
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
                }

                const data = await response.json();
                const replyContent = data.choices[0].message.content;
                console.log('语音通话API回复:', replyContent.substring(0, 300));

                // 解析回复
                const parsed = vcParseReply(replyContent);

                // 移除loading
                const loadingEl = document.getElementById(loadingId);
                if (loadingEl) loadingEl.remove();

                // 添加助手消息并播放TTS
                for (const msg of parsed) {
                    vcState.messages.push({ role: 'assistant', content: msg.content, emotion: msg.emotion || 'neutral' });
                    vcRenderMessages();

                    // TTS自动播放（优先用语音通话设置的voiceId，其次微信助手设置，最后默认）
                    const conv = wechatData.conversations?.[vcState.assistantId];
                    const isEdge = appData.ttsSettings.engine === 'edge';
                    const voiceId = isEdge
                        ? (voiceCallData.settings.edgeVoiceId || conv?.settings?.edgeVoiceId || 'zh-CN-XiaoxiaoNeural')
                        : (voiceCallData.settings.voiceId || conv?.settings?.voiceId || 'male-qn-qingse');
                    const ttsReady = isTtsConfigured();
                    console.log('语音通话TTS检查:', ttsReady, '引擎:', appData.ttsSettings.engine, 'voiceId:', voiceId);
                    if (ttsReady) {
                        try {
                            resetAudioRoute();
                            await new Promise(r => setTimeout(r, 100));
                            await vcPlayTts(msg.content, voiceId, msg.emotion || 'neutral');
                        } catch(e) {
                            console.warn('TTS播放失败:', e);
                        }
                    }
                }

            } catch(error) {
                console.error('语音通话请求失败:', error);
                const loadingEl = document.getElementById(loadingId);
                if (loadingEl) loadingEl.remove();
                vcState.messages.push({ role: 'assistant', content: '请求失败: ' + error.message });
                vcRenderMessages();
            }

            vcState.isProcessing = false;

            // 重启语音识别（AI回复完毕后自动恢复听写）
            if (document.getElementById('voiceCallActivePage').classList.contains('active')) {
                vcState.pendingText = '';
                vcState.processedCount = 0;
                startVcRecognition();
            }
        }

        // 构建语音通话请求消息
        async function buildVcRequestMessages() {
            const assistant = vcState.assistant;
            let systemPrompt = assistant.systemPrompt || '';

            systemPrompt += `

你现在正在与用户进行实时语音通话，就像打电话一样。

# 输出格式铁律（最高优先级）
- 你的回复【必须且只能】是一个JSON数组。
- 【绝对禁止】在JSON数组之外输出任何文字。

## 第一步：思维链
{"type":"thinking","content":"简要分析用户说了什么，你打算怎么回应"}

## 第二步：语音回复
{"type":"voice_message","content":"你说的话","emotion":"情绪"}
- emotion必填：happy/sad/angry/fearful/disgusted/surprised/calm
- 每次回复控制在50-100字以内，像打电话说话一样简洁自然
- 口语化，就像面对面说话，不要书面语

## 标点符号控制节奏（重要！TTS会根据标点停顿）
- 逗号（，）：短停顿
- 句号（。）：正常停顿
- 问号（？）：语气上扬
- 省略号（……）：拖长+停顿，犹豫/思考
- 波浪号（～）：拖音，俏皮感
- 感叹号（！）：强调

## 口语化技巧
- 自然的重复和自我修正
- 像真人说话一样有呼吸感
- 可适当插入拟声词标签增强表现力，【只能】使用以下标签，禁止自创：
  (laughs) (chuckle) (coughs) (clear-throat) (groans) (breath) (pant) (inhale) (exhale) (gasps) (sniffs) (sighs) (snorts) (burps) (lip-smacking) (humming) (hissing) (emm) (sneezes)

## 输出结构
[
  {"type":"thinking","content":"..."},
  {"type":"voice_message","content":"...","emotion":"..."}
]`;

            // 时间感知
            const now = new Date();
            const timeStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
            systemPrompt += `\n\n【当前时间】${timeStr}`;

            // 长期记忆
            const conv = wechatData.conversations?.[vcState.assistantId];
            const longTermMemory = conv?.settings?.longTermMemory || [];
            if (longTermMemory.length > 0) {
                systemPrompt += `\n\n【长期记忆】\n` + longTermMemory.map(m => `- ${m.content}`).join('\n');
            }

            // 向量记忆检索
            if (voiceCallData.settings.vectorMemoryEnabled && cloudSyncEnabled() && mlabConfig.siliconFlowKey) {
                try {
                    // 构建query：合并当前通话最近的用户消息
                    let queryParts = [];
                    for (let i = vcState.messages.length - 1; i >= 0 && queryParts.length < 10; i--) {
                        if (vcState.messages[i].role === 'user' && vcState.messages[i].content?.trim()) {
                            queryParts.unshift(vcState.messages[i].content.trim());
                        } else if (vcState.messages[i].role === 'assistant') {
                            if (queryParts.length > 0) break;
                        }
                    }
                    // 也合并微信上下文最近的用户消息（如果开了携带微信上下文）
                    if (voiceCallData.settings.carryWechatContext && conv?.messages?.length) {
                        const wMsgs = conv.messages;
                        let wParts = [];
                        for (let i = wMsgs.length - 1; i >= 0 && wParts.length < 5; i--) {
                            if (wMsgs[i].role === 'user' && typeof wMsgs[i].content === 'string' && wMsgs[i].content.trim()) {
                                wParts.unshift(wMsgs[i].content.trim());
                            } else if (wMsgs[i].role === 'assistant') {
                                if (wParts.length > 0) break;
                            }
                        }
                        queryParts = wParts.concat(queryParts);
                    }
                    const queryText = queryParts.join(' ').slice(0, 500);

                    if (queryText) {
                        const topK = mlabConfig.searchTopK || 5;
                        const contextN = mlabConfig.searchContextN || 20;
                        const weights = {
                            similarity: mlabConfig.searchWSim != null ? mlabConfig.searchWSim : 0.5,
                            recency: mlabConfig.searchWRec != null ? mlabConfig.searchWRec : 0.3,
                            importance: mlabConfig.searchWImp != null ? mlabConfig.searchWImp : 0.2
                        };

                        const results = await mlabSearchNarratives(queryText, topK * 2, vcState.assistantId, weights);

                        if (results && results.length > 0) {
                            // 时间去重：如果开了微信上下文，用微信上下文做时间窗口去重
                            let filtered = results;
                            if (voiceCallData.settings.carryWechatContext && conv?.messages?.length) {
                                const ctxCount = voiceCallData.settings.contextCount || 30;
                                const contextMessages = conv.messages.slice(-ctxCount);
                                const earliestTimestamp = contextMessages[0]?.timestamp || null;
                                if (earliestTimestamp) {
                                    filtered = results.filter(r => {
                                        const endTime = r.end_time || r.narrative?.end_time;
                                        if (!endTime) return true;
                                        return new Date(endTime) < new Date(earliestTimestamp);
                                    });
                                }
                            }
                            filtered = filtered.slice(0, topK);

                            if (filtered.length > 0) {
                                const vectorMemoryText = filtered.map(r => {
                                    const n = r.narrative || {};
                                    let parts = [];
                                    const timeStr = r.start_time || r.end_time
                                        ? (() => {
                                            const fmt = t => { try { return new Date(t).toLocaleDateString('zh-CN', {month:'long',day:'numeric'}); } catch(e) { return ''; } };
                                            return r.start_time ? fmt(r.start_time) + (r.end_time && r.end_time !== r.start_time ? '~' + fmt(r.end_time) : '') : fmt(r.end_time);
                                        })()
                                        : '';
                                    if (timeStr) parts.push(`[${timeStr}]`);
                                    if (n.context) parts.push(n.context);
                                    const quotes = n.user_quotes || [];
                                    if (quotes.length > 0) {
                                        parts.push('用户说：' + quotes.map(q => `「${q}」`).join(' '));
                                    }
                                    if (n.assistant_summary) parts.push(`你当时：${n.assistant_summary}`);
                                    return `- ${parts.join(' ')}`;
                                }).join('\n');
                                systemPrompt += `\n\n【向量记忆 - 相关历史记忆片段】\n以下是从记忆库中检索到的与当前话题相关的历史记忆，请自然地参考：\n${vectorMemoryText}`;
                                console.log(`语音通话向量记忆: query="${queryText.slice(0,50)}..." 召回${results.length}条，去重后${filtered.length}条已注入`);
                            } else {
                                console.log(`语音通话向量记忆: 召回${results.length}条，去重后全部过滤`);
                            }
                        }
                    }
                } catch (err) {
                    console.warn('语音通话向量记忆检索失败，跳过:', err.message);
                }
            }

            let fullContent = systemPrompt + '\n\n=====对话记录=====\n';

            // 携带微信上下文
            console.log('语音通话上下文检查:', {
                carryWechatContext: voiceCallData.settings.carryWechatContext,
                assistantId: vcState.assistantId,
                hasConv: !!conv,
                msgCount: conv?.messages?.length || 0
            });
            if (voiceCallData.settings.carryWechatContext && conv?.messages?.length) {
                const ctxCount = voiceCallData.settings.contextCount || 30;
                const ctxMsgs = conv.messages.slice(-ctxCount);
                fullContent += '【微信聊天上下文】\n';
                const assistantName = assistant.name || '助手';
                ctxMsgs.forEach(m => {
                    const speaker = m.role === 'user' ? '用户' : assistantName;
                    const content = m.content || (m.type === 'image' ? '[图片]' : '');
                    if (content) fullContent += `${speaker}: ${content}\n`;
                });
                fullContent += '\n【以下是当前语音通话】\n';
            }

            // 当前通话消息
            const assistantName = assistant.name || '助手';
            vcState.messages.forEach(m => {
                const speaker = m.role === 'user' ? '用户' : assistantName;
                fullContent += `${speaker}: ${m.content}\n`;
            });

            return [{ role: 'user', content: fullContent }];
        }

        // 解析AI回复
        function vcParseReply(content) {
            let trimmed = content.trim();

            // 第一步：清理思考标签和干扰内容
            trimmed = trimmed.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
            trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, '');
            trimmed = trimmed.replace(/```thinking[\s\S]*?```/gi, '');
            trimmed = trimmed.replace(/[\[【]思考[\]】][\s\S]*?[\[【]\/思考[\]】]/gi, '');
            trimmed = trimmed.trim();

            if (!trimmed) {
                console.warn('清理思考链后内容为空，使用原始内容');
                trimmed = content.trim();
            }

            const results = [];

            // 第二步：尝试标准 JSON 解析
            try {
                // 处理代码块格式
                if (trimmed.includes('```')) {
                    trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
                    console.log('语音通话：检测到代码块格式，已去除标记');
                }

                // 修复中文标点
                trimmed = fixChinesePunctuation(trimmed);

                let arr;
                if (trimmed.startsWith('[')) {
                    arr = JSON.parse(trimmed);
                } else {
                    // AI 可能在 JSON 前面加了废话
                    const match = trimmed.match(/\[[\s\S]*?\](?=\s*$|\s*```)/) || trimmed.match(/\[[\s\S]*\]/);
                    arr = match ? JSON.parse(match[0]) : null;
                }

                if (Array.isArray(arr)) {
                    for (const item of arr) {
                        if (item.type === 'thinking') continue;
                        if (item.type === 'voice_message' && item.content) {
                            results.push({ content: item.content, emotion: item.emotion || 'neutral' });
                        } else if (item.content) {
                            results.push({ content: item.content, emotion: item.emotion || 'neutral' });
                        }
                    }
                }

                if (results.length > 0) {
                    console.log(`语音通话：成功解析${results.length}条回复`);
                }
            } catch(e) {
                console.warn('语音通话JSON标准解析失败:', e.message);

                // 第三步：容错 —— 尝试修复不完整 JSON
                try {
                    let fixAttempt = trimmed;
                    fixAttempt = fixAttempt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

                    // 缺少闭合括号的情况
                    if (fixAttempt.startsWith('[') && !fixAttempt.endsWith(']')) {
                        const lastObj = fixAttempt.lastIndexOf('}');
                        if (lastObj > 0) {
                            fixAttempt = fixAttempt.substring(0, lastObj + 1) + ']';
                            const arr = JSON.parse(fixAttempt);
                            for (const item of arr) {
                                if (item.type === 'thinking') continue;
                                if (item.content) {
                                    results.push({ content: item.content, emotion: item.emotion || 'neutral' });
                                }
                            }
                            console.log(`语音通话容错：修复后解析到${results.length}条回复`);
                        }
                    }

                    // 逐个提取 JSON 对象
                    if (results.length === 0) {
                        const objPattern = /\{\s*"type"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*(?:,\s*"emotion"\s*:\s*"([^"]+)")?\s*\}/g;
                        let match;
                        while ((match = objPattern.exec(content)) !== null) {
                            if (match[1] === 'thinking') continue;
                            results.push({
                                content: match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n'),
                                emotion: match[3] || 'neutral'
                            });
                        }
                        if (results.length > 0) {
                            console.log(`语音通话容错：正则提取到${results.length}条回复`);
                        }
                    }
                } catch(e2) {
                    console.warn('语音通话容错解析也失败:', e2.message);
                }
            }

            // 第四步：兜底 —— 当纯文本处理
            if (results.length === 0) {
                console.log('语音通话：未能解析JSON，作为纯文本处理');
                // 去掉 JSON 残留，提取纯文字
                let cleaned = trimmed
                    .replace(/\[?\s*\{[^}]*"type"\s*:\s*"thinking"[^}]*\}\s*,?\s*/g, '')  // 去 thinking 对象
                    .replace(/[\[\]{}]/g, '')  // 去 JSON 符号
                    .replace(/"type"\s*:\s*"[^"]*"\s*,?\s*/g, '')
                    .replace(/"content"\s*:\s*/g, '')
                    .replace(/"emotion"\s*:\s*"[^"]*"\s*,?\s*/g, '')
                    .replace(/"/g, '')
                    .trim();
                if (!cleaned) cleaned = trimmed;
                results.push({ content: cleaned, emotion: 'neutral' });
            }
            return results;
        }

        // TTS播放 - 复用现有的playTtsAudioWithCallback，传入预解锁Audio绕过Safari限制
        async function vcPlayTts(text, voiceId, emotion) {
            return new Promise((resolve, reject) => {
                playTtsAudioWithCallback(text, voiceId,
                    () => {
                        // onStart: 记录当前播放的audioUrl用于保存
                        const cacheKey = appData.ttsSettings.engine === 'edge'
                            ? `edge|${voiceId}|neutral|${text}`
                            : `${voiceId}|${appData.ttsSettings.model}|${emotion}|${text}`;
                        const cachedUrl = ttsCache.get(cacheKey);
                        if (cachedUrl) {
                            const lastMsg = vcState.messages[vcState.messages.length - 1];
                            if (lastMsg) lastMsg._audioUrl = cachedUrl;
                        }
                        console.log('语音通话TTS开始播放');
                    },
                    () => {
                        // onEnd
                        console.log('语音通话TTS播放完毕');
                        resolve();
                    },
                    emotion,
                    vcUnlockedAudio  // 传入预解锁的Audio对象，绕过Safari自动播放限制
                ).catch(e => {
                    console.warn('TTS播放失败:', e);
                    reject(e);
                });
            });
        }

        // 渲染通话消息
        function vcRenderMessages() {
            const el = document.getElementById('vcMessages');
            el.innerHTML = vcState.messages.map(m => {
                const cls = m.role === 'user' ? 'vc-msg-user' : 'vc-msg-assistant';
                // 助手消息去除拟声词标签（不让用户看到标签文本）
                const displayContent = m.role === 'assistant' ? stripInterjectionsAlways(m.content) : m.content;
                return `<div class="vc-msg ${cls}">${displayContent}</div>`;
            }).join('');
            el.scrollTop = el.scrollHeight;
        }

        // ---- 挂断 ----
        function hangupVoiceCall() {
            stopVcRecognition();
            stopVcTimer();
            stopVcWaveform();
            if (currentTtsAudio) {
                currentTtsAudio.pause();
                currentTtsAudio = null;
            }
            resetAudioRoute();

            if (vcState.messages.length > 0) {
                document.getElementById('vcSaveModal').classList.add('show');
                document.getElementById('vcSaveTitle').textContent = '是否保存通话记录？';
                document.getElementById('vcSaveBtns').style.display = 'flex';
            } else {
                closePage('voiceCallActivePage');
            }
        }

        function vcDiscardCall() {
            document.getElementById('vcSaveModal').classList.remove('show');
            closePage('voiceCallActivePage');
        }

        async function vcSaveCall() {
            const saveBtns = document.getElementById('vcSaveBtns');
            saveBtns.style.display = 'none';
            document.getElementById('vcSaveTitle').textContent = '正在保存...';

            const record = {
                id: 'vcrec_' + Date.now(),
                assistantId: vcState.assistantId,
                assistantName: vcState.assistant?.name || '助手',
                startTime: vcState.startTime?.toISOString(),
                endTime: new Date().toISOString(),
                duration: vcState.timerSeconds,
                messages: vcState.messages.map(m => ({
                    role: m.role,
                    content: m.content,
                    emotion: m.emotion || undefined
                }))
            };

            // 下载TTS音频并保存
            let audioIndex = 0;
            for (let i = 0; i < vcState.messages.length; i++) {
                const msg = vcState.messages[i];
                if (msg.role === 'assistant' && msg._audioUrl) {
                    try {
                        const resp = await fetch(msg._audioUrl);
                        const blob = await resp.blob();
                        const audioKey = `${record.id}_${i}`;
                        await saveVoiceCallAudio(audioKey, blob);
                        record.messages[i].hasAudio = true;
                        record.messages[i].audioKey = audioKey;
                        audioIndex++;
                    } catch(e) {
                        console.warn('保存音频失败:', e);
                    }
                }
            }

            voiceCallData.records.push(record);
            saveVoiceCallData();

            document.getElementById('vcSaveTitle').textContent = '保存成功';
            setTimeout(() => {
                document.getElementById('vcSaveModal').classList.remove('show');
                closePage('voiceCallActivePage');
            }, 1000);
        }

        // ---- 设置 ----
        function openVoiceCallSettings() {
            const s = voiceCallData.settings;
            const autoSendEl = document.getElementById('vcAutoSend');
            if (s.autoSend) autoSendEl.classList.add('on');
            else autoSendEl.classList.remove('on');

            document.getElementById('vcAutoSendDelay').value = s.autoSendDelay || 2;
            document.getElementById('vcAutoSendDelayRow').style.display = s.autoSend ? 'flex' : 'none';

            const ctxEl = document.getElementById('vcCarryContext');
            if (s.carryWechatContext) ctxEl.classList.add('on');
            else ctxEl.classList.remove('on');

            document.getElementById('vcContextCount').value = s.contextCount || 30;
            document.getElementById('vcContextCountRow').style.display = s.carryWechatContext ? 'flex' : 'none';

            const vmEl = document.getElementById('vcVectorMemory');
            if (s.vectorMemoryEnabled) vmEl.classList.add('on');
            else vmEl.classList.remove('on');

            document.getElementById('vcVoiceId').value = s.voiceId || '';

            // Edge TTS 音色 UI
            if (appData.ttsSettings.engine === 'edge') {
                const currentVoice = s.edgeVoiceId || 'zh-CN-XiaoxiaoNeural';
                document.getElementById('vcEdgeGender').value = getEdgeVoiceGender(currentVoice);
                populateEdgeVoiceSelect('vcEdgeVoice', 'vcEdgeGender', currentVoice);
            }
            toggleVoiceIdFields();

            openPage('voiceCallSettingsPage');
        }

        function toggleVcAutoSendDelay() {
            const on = document.getElementById('vcAutoSend').classList.contains('on');
            document.getElementById('vcAutoSendDelayRow').style.display = on ? 'flex' : 'none';
        }

        function toggleVcContextCount() {
            const on = document.getElementById('vcCarryContext').classList.contains('on');
            document.getElementById('vcContextCountRow').style.display = on ? 'flex' : 'none';
        }

        function saveVoiceCallSettings() {
            voiceCallData.settings.autoSend = document.getElementById('vcAutoSend').classList.contains('on');
            voiceCallData.settings.autoSendDelay = parseInt(document.getElementById('vcAutoSendDelay').value) || 2;
            voiceCallData.settings.carryWechatContext = document.getElementById('vcCarryContext').classList.contains('on');
            voiceCallData.settings.contextCount = parseInt(document.getElementById('vcContextCount').value) || 30;
            voiceCallData.settings.voiceId = document.getElementById('vcVoiceId').value.trim();
            voiceCallData.settings.edgeVoiceId = document.getElementById('vcEdgeVoice').value || 'zh-CN-XiaoxiaoNeural';
            voiceCallData.settings.vectorMemoryEnabled = document.getElementById('vcVectorMemory').classList.contains('on');
            saveVoiceCallData();
            closePage('voiceCallSettingsPage');
        }

        // ---- 通话记录（日历）----
        function openVoiceCallRecords() {
            vcCalendarYear = new Date().getFullYear();
            vcCalendarMonth = new Date().getMonth();
            vcSelectedDate = null;
            renderVcCalendar();
            document.getElementById('vcRecordList').innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">选择日期查看通话记录</div>';
            openPage('voiceCallRecordsPage');
        }

        function vcCalendarPrevMonth() {
            vcCalendarMonth--;
            if (vcCalendarMonth < 0) { vcCalendarMonth = 11; vcCalendarYear--; }
            renderVcCalendar();
        }

        function vcCalendarNextMonth() {
            vcCalendarMonth++;
            if (vcCalendarMonth > 11) { vcCalendarMonth = 0; vcCalendarYear++; }
            renderVcCalendar();
        }

        function renderVcCalendar() {
            document.getElementById('vcCalendarTitle').textContent = `${vcCalendarYear}年${vcCalendarMonth + 1}月`;
            const daysEl = document.getElementById('vcCalendarDays');

            const firstDay = new Date(vcCalendarYear, vcCalendarMonth, 1);
            const lastDay = new Date(vcCalendarYear, vcCalendarMonth + 1, 0);
            const startWeekday = firstDay.getDay();
            const daysInMonth = lastDay.getDate();
            const today = new Date();
            today.setHours(0,0,0,0);

            // 统计每天的记录数
            const recordCountByDay = {};
            voiceCallData.records.forEach(r => {
                const d = new Date(r.startTime);
                if (d.getFullYear() === vcCalendarYear && d.getMonth() === vcCalendarMonth) {
                    const day = d.getDate();
                    recordCountByDay[day] = (recordCountByDay[day] || 0) + 1;
                }
            });

            let html = '';
            // 上月填充
            const prevDays = new Date(vcCalendarYear, vcCalendarMonth, 0).getDate();
            for (let i = startWeekday - 1; i >= 0; i--) {
                html += `<div class="vc-calendar-day other-month">${prevDays - i}</div>`;
            }

            // 当月
            for (let day = 1; day <= daysInMonth; day++) {
                const dateObj = new Date(vcCalendarYear, vcCalendarMonth, day);
                dateObj.setHours(0,0,0,0);
                const isFuture = dateObj > today;
                const isToday = dateObj.getTime() === today.getTime();
                const count = recordCountByDay[day] || 0;
                const dateStr = `${vcCalendarYear}-${vcCalendarMonth}-${day}`;
                const isSelected = dateStr === vcSelectedDate;

                let cls = 'vc-calendar-day';
                if (isToday) cls += ' today';
                if (isSelected) cls += ' selected';
                if (count > 0) cls += ' has-records';
                if (isFuture) cls += ' future';

                const dots = count > 0
                    ? `<div class="vc-calendar-dots">${Array(Math.min(count, 3)).fill('<div class="vc-calendar-dot"></div>').join('')}</div>`
                    : '';

                const click = isFuture ? '' : `onclick="selectVcDate('${dateStr}')"`;
                html += `<div class="${cls}" ${click}>${day}${dots}</div>`;
            }

            // 下月填充
            const totalCells = startWeekday + daysInMonth;
            const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
            for (let i = 1; i <= remaining; i++) {
                html += `<div class="vc-calendar-day other-month">${i}</div>`;
            }

            daysEl.innerHTML = html;
        }

        function selectVcDate(dateStr) {
            vcSelectedDate = dateStr;
            renderVcCalendar();

            const [y, m, d] = dateStr.split('-').map(Number);
            const dayStart = new Date(y, m, d);
            const dayEnd = new Date(y, m, d + 1);

            const dayRecords = voiceCallData.records.filter(r => {
                const t = new Date(r.startTime);
                return t >= dayStart && t < dayEnd;
            });

            const listEl = document.getElementById('vcRecordList');
            if (dayRecords.length === 0) {
                listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">当天无通话记录</div>';
                return;
            }

            listEl.innerHTML = dayRecords.map(r => {
                const t = new Date(r.startTime);
                const timeStr = `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`;
                const durM = Math.floor(r.duration / 60);
                const durS = r.duration % 60;
                const durStr = durM > 0 ? `${durM}分${durS}秒` : `${durS}秒`;
                return `<div class="vc-record-card" onclick="openVcRecordDetail('${r.id}')">
                    <div class="vc-record-info">
                        <span class="vc-record-assistant">${r.assistantName}</span>
                        <span class="vc-record-time">${timeStr}</span>
                    </div>
                    <div class="vc-record-duration">通话 ${durStr}</div>
                </div>`;
            }).join('');
        }

        // ---- 记录详情 ----
        function openVcRecordDetail(recordId) {
            // 找到当天所有记录
            if (vcSelectedDate) {
                const [y, m, d] = vcSelectedDate.split('-').map(Number);
                const dayStart = new Date(y, m, d);
                const dayEnd = new Date(y, m, d + 1);
                vcDetailRecords = voiceCallData.records.filter(r => {
                    const t = new Date(r.startTime);
                    return t >= dayStart && t < dayEnd;
                });
                vcDetailIndex = vcDetailRecords.findIndex(r => r.id === recordId);
                if (vcDetailIndex < 0) vcDetailIndex = 0;
            } else {
                vcDetailRecords = [voiceCallData.records.find(r => r.id === recordId)].filter(Boolean);
                vcDetailIndex = 0;
            }
            renderVcRecordDetail();
            openPage('voiceCallDetailPage');
        }

        function renderVcRecordDetail() {
            const record = vcDetailRecords[vcDetailIndex];
            if (!record) return;

            const t = new Date(record.startTime);
            const dateStr = `${t.getFullYear()}年${t.getMonth()+1}月${t.getDate()}日`;
            const timeStr = `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`;
            const durM = Math.floor(record.duration / 60);
            const durS = record.duration % 60;
            const durStr = durM > 0 ? `${durM}分${durS}秒` : `${durS}秒`;

            document.getElementById('vcDetailHeader').innerHTML = `
                <div class="vc-detail-date">${dateStr} ${timeStr}</div>
                <div class="vc-detail-meta">通话时长 ${durStr}</div>
                <div class="vc-detail-assistant">${record.assistantName}</div>
            `;

            // 多条记录导航
            const nav = document.getElementById('vcDetailNav');
            if (vcDetailRecords.length > 1) {
                nav.style.display = 'flex';
                document.getElementById('vcDetailNavText').textContent = `${vcDetailIndex + 1}/${vcDetailRecords.length}`;
                document.getElementById('vcDetailPrev').disabled = vcDetailIndex <= 0;
                document.getElementById('vcDetailNext').disabled = vcDetailIndex >= vcDetailRecords.length - 1;
            } else {
                nav.style.display = 'none';
            }

            // 渲染消息
            const userName = '我';
            const assistantName = record.assistantName;
            document.getElementById('vcDetailMessages').innerHTML = record.messages.map((m, i) => {
                const isUser = m.role === 'user';
                const cls = isUser ? 'vc-detail-msg-user' : 'vc-detail-msg-assistant';
                const name = isUser ? userName : assistantName;
                const playBtn = (!isUser && m.hasAudio)
                    ? `<button class="vc-detail-play-btn" onclick="vcPlayRecordAudio('${m.audioKey}', this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>`
                    : '';
                return `<div class="vc-detail-msg ${cls}">
                    <div class="vc-detail-msg-name">${name}</div>
                    <div class="vc-detail-msg-bubble">${m.content}${playBtn}</div>
                </div>`;
            }).join('');
        }

        function vcDetailPrevRecord() {
            if (vcDetailIndex > 0) { vcDetailIndex--; renderVcRecordDetail(); }
        }

        function vcDetailNextRecord() {
            if (vcDetailIndex < vcDetailRecords.length - 1) { vcDetailIndex++; renderVcRecordDetail(); }
        }

        // 播放保存的录音
        async function vcPlayRecordAudio(audioKey, btnEl) {
            try {
                const blob = await loadVoiceCallAudio(audioKey);
                if (!blob) { alert('音频数据未找到'); return; }
                const url = URL.createObjectURL(blob);
                if (currentTtsAudio) { currentTtsAudio.pause(); currentTtsAudio = null; }
                const audio = new Audio(url);
                currentTtsAudio = audio;
                btnEl.style.color = '#e53935';
                audio.onended = () => { btnEl.style.color = '#4caf50'; URL.revokeObjectURL(url); currentTtsAudio = null; };
                audio.onerror = () => { btnEl.style.color = '#4caf50'; URL.revokeObjectURL(url); currentTtsAudio = null; };
                audio.play();
            } catch(e) {
                console.error('播放录音失败:', e);
                alert('播放失败');
            }
        }
