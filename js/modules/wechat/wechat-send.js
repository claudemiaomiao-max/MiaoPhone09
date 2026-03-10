/**
 * 微信模式 - 发送消息
 *
 * 负责：暂存消息(wechatHoldMessage)、发送消息(wechatSendMessage)、
 *        构建请求消息(buildWechatRequestMessages)、解析AI回复(parseAndAddWechatReplies)、
 *        语音播放(playWechatVoice)、修复中文标点(fixChinesePunctuation)
 * 暴露函数：wechatHoldMessage, wechatSendMessage, buildWechatRequestMessages,
 *           parseAndAddWechatReplies, playWechatVoice
 * 依赖：appData(data.js), wechatData/saveWechatData/renderWechatMessages/
 *        renderWechatList/wechatPendingFetches/wechatUnreadCounts(wechat-core.js),
 *        pendingFiles/clearPendingFiles(file-upload.js),
 *        mlabSearchNarratives(memory-lab.js), checkAutoSummary(wechat-memory.js),
 *        playTtsAudio/isTtsConfigured(tts.js), escapeHtml(ui.js)
 */

        function wechatHoldMessage() {
            const input = document.getElementById('wechatInput');
            const content = input.value.trim();
            const filesToSend = [...pendingFiles];
            const hasFiles = filesToSend.length > 0;

            // 既没有文字也没有图片则不处理
            if (!content && !hasFiles) return;

            // 先添加文件到暂存
            if (hasFiles) {
                for (const file of filesToSend) {
                    if (file.isImage) {
                        const imgMsg = {
                            id: 'wmsg_' + Date.now() + '_img_' + Math.random().toString(36).substr(2, 5),
                            role: 'user',
                            type: 'image',
                            content: file.base64,
                            fileName: file.name,
                            timestamp: new Date().toISOString(),
                            _targetAssistantId: wechatData.currentAssistantId
                        };
                        wechatData.pendingMessages.push(imgMsg);
                    } else if (file.isTextFile && file.textContent) {
                        const fileMsg = {
                            id: 'wmsg_' + Date.now() + '_file_' + Math.random().toString(36).substr(2, 5),
                            role: 'user',
                            type: 'text',
                            content: `[文件: ${file.name}]\n${file.textContent}`,
                            fileName: file.name,
                            isFile: true,
                            timestamp: new Date().toISOString(),
                            _targetAssistantId: wechatData.currentAssistantId
                        };
                        wechatData.pendingMessages.push(fileMsg);
                    }
                }
                clearPendingFiles();
            }

            // 再添加文字到暂存（包含引用信息）
            if (content) {
                // Aa前缀快捷语音消息
                const isVoiceShortcut = content.startsWith('Aa') && content.length > 2;
                const msg = {
                    id: 'wmsg_' + Date.now(),
                    role: 'user',
                    type: isVoiceShortcut ? 'voice_message' : 'text',
                    content: isVoiceShortcut ? content.slice(2) : content,
                    timestamp: new Date().toISOString(),
                    _targetAssistantId: wechatData.currentAssistantId
                };
                // 如果有引用消息，添加引用信息
                if (wechatQuotedMessage) {
                    msg.quote = {
                        id: wechatQuotedMessage.id,
                        senderName: wechatQuotedMessage.senderName,
                        content: wechatQuotedMessage.fullContent || wechatQuotedMessage.content  // 优先使用完整内容
                    };
                    clearWechatQuote();
                }
                wechatData.pendingMessages.push(msg);
                input.value = '';
                input.style.height = 'auto';
            }

            renderWechatMessages();
        }

        async function wechatSendMessage() {
            const input = document.getElementById('wechatInput');
            const content = input.value.trim();
            const filesToSend = [...pendingFiles];
            const hasFiles = filesToSend.length > 0;
            const hasQuote = wechatQuotedMessage !== null;

            // 【关键】在函数最开头锁定目标助手ID，后续全部用这个，不依赖 currentAssistantId
            const targetAssistantId = wechatData.currentAssistantId;

            // 如果有文件，先添加到暂存
            if (hasFiles) {
                for (const file of filesToSend) {
                    if (file.isImage) {
                        const imgMsg = {
                            id: 'wmsg_' + Date.now() + '_img_' + Math.random().toString(36).slice(2, 6),
                            role: 'user',
                            type: 'image',
                            content: file.base64,
                            fileName: file.name,
                            timestamp: new Date().toISOString(),
                            _targetAssistantId: targetAssistantId
                        };
                        wechatData.pendingMessages.push(imgMsg);
                    } else if (file.isTextFile && file.textContent) {
                        // 文本文件：作为文本消息发送，标注文件名
                        const fileMsg = {
                            id: 'wmsg_' + Date.now() + '_file_' + Math.random().toString(36).slice(2, 6),
                            role: 'user',
                            type: 'text',
                            content: `[文件: ${file.name}]\n${file.textContent}`,
                            fileName: file.name,
                            isFile: true,
                            timestamp: new Date().toISOString(),
                            _targetAssistantId: targetAssistantId
                        };
                        wechatData.pendingMessages.push(fileMsg);
                    }
                }
                clearPendingFiles();
            }

            // 如果输入框有内容，添加文本消息到暂存（包含引用信息）
            if (content) {
                // Aa前缀快捷语音消息：以Aa开头则作为语音消息发送
                const isVoiceShortcut = content.startsWith('Aa') && content.length > 2;
                const msg = {
                    id: 'wmsg_' + Date.now(),
                    role: 'user',
                    type: isVoiceShortcut ? 'voice_message' : 'text',
                    content: isVoiceShortcut ? content.slice(2) : content,
                    timestamp: new Date().toISOString(),
                    _targetAssistantId: targetAssistantId
                };
                // 如果有引用消息，添加引用信息
                if (wechatQuotedMessage) {
                    msg.quote = {
                        id: wechatQuotedMessage.id,
                        senderName: wechatQuotedMessage.senderName,
                        content: wechatQuotedMessage.fullContent || wechatQuotedMessage.content  // 优先使用完整内容
                    };
                    clearWechatQuote();
                }
                wechatData.pendingMessages.push(msg);
                input.value = '';
                input.style.height = 'auto';
            }

            const conv = wechatData.conversations[targetAssistantId];
            const hasPending = wechatData.pendingMessages.some(m => m._targetAssistantId === targetAssistantId);
            const lastMsg = conv?.messages?.length ? conv.messages[conv.messages.length - 1] : null;
            const needsReply = lastMsg && lastMsg.role === 'user';

            // 既没有新消息，也不需要补回复 -> 才return
            if (!hasPending && !needsReply) return;

            const assistant = appData.assistants.find(a => a.id === targetAssistantId);

            // 获取模型：助手默认模型 > 全局默认模型
            const assistantModel = assistant?.providerId && assistant?.modelId ? `${assistant.providerId}||${assistant.modelId}` : '';
            const globalModel = appData.settings.defaultModel;
            const modelValue = assistantModel || globalModel;
            if (!modelValue) {
                alert('请先在设置中选择默认模型');
                return;
            }
            const [providerId, modelId] = modelValue.split('||');
            const provider = appData.providers.find(p => p.id === providerId);

            if (!provider) {
                alert('找不到对应的供应商配置');
                return;
            }

            // 创建带有正确模型的临时助手对象
            const effectiveAssistant = { ...assistant, providerId, modelId };

            // 有暂存消息才执行"把暂存移到正式消息"（只移属于目标助手的）
            if (hasPending) {
                const myPending = wechatData.pendingMessages.filter(m => m._targetAssistantId === targetAssistantId);
                const otherPending = wechatData.pendingMessages.filter(m => m._targetAssistantId !== targetAssistantId);
                myPending.forEach(msg => {
                    delete msg._targetAssistantId; // 移入正式消息后去掉内部标记
                    conv.messages.push(msg);
                });
                wechatData.pendingMessages = otherPending;
                // 只有当前在看这个对话才渲染
                if (wechatData.currentAssistantId === targetAssistantId) {
                    renderWechatMessages();
                }
                saveWechatData();
            }

            // 标记该助手正在等待AI回复
            wechatPendingFetches[targetAssistantId] = true;

            // 只有当前在看这个对话才操作UI元素
            if (wechatData.currentAssistantId === targetAssistantId) {
                document.getElementById('wechatSendBtn').disabled = true;
                const typingEl = document.getElementById('wechatTyping');
                if (typingEl) typingEl.classList.add('show');
            }

            // 更新联系人列表（显示"正在输入"状态）
            renderWechatList();

            try {
                // 构建请求
                let requestMessages;
                try {
                    requestMessages = await buildWechatRequestMessages(conv, effectiveAssistant);
                } catch (buildError) {
                    console.error('构建请求消息失败:', buildError);
                    throw new Error('构建消息失败: ' + buildError.message);
                }

                const requestBody = {
                    model: effectiveAssistant.modelId,
                    messages: requestMessages,
                    temperature: effectiveAssistant.temperature || 0.8
                };

                // 检查请求体大小
                let bodyStr;
                try {
                    bodyStr = JSON.stringify(requestBody);
                } catch (jsonError) {
                    console.error('JSON序列化失败:', jsonError);
                    throw new Error('消息序列化失败，可能包含无法处理的数据');
                }

                const bodySizeMB = (bodyStr.length / 1024 / 1024).toFixed(2);
                console.log(`请求体大小: ${bodySizeMB}MB`);

                if (bodyStr.length > 10 * 1024 * 1024) { // 超过10MB警告
                    console.warn('请求体过大，可能导致请求失败');
                }

                const response = await fetch(provider.baseUrl + provider.apiPath, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + provider.apiKey
                    },
                    body: bodyStr
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
                }

                const data = await response.json();
                const replyContent = data.choices[0].message.content;

                // 调试：打印API原始响应
                console.log('API原始响应:', replyContent.substring(0, 500));

                // 解析回复（尝试JSON数组，否则当普通文本处理）
                // 所有清理逻辑通过onComplete回调在最后一条消息渲染后执行
                parseAndAddWechatReplies(replyContent, conv, targetAssistantId, () => {
                    // 清除pending状态
                    delete wechatPendingFetches[targetAssistantId];

                    // 根据用户当前在看哪个窗口决定UI更新策略
                    if (wechatData.currentAssistantId === targetAssistantId) {
                        const typingElEnd = document.getElementById('wechatTyping');
                        if (typingElEnd) typingElEnd.classList.remove('show');
                        document.getElementById('wechatSendBtn').disabled = false;
                    }

                    // 无论在哪都更新联系人列表
                    renderWechatList();

                    // 检查是否需要自动总结记忆
                    checkAutoSummary();
                });

            } catch (error) {
                console.error('请求失败:', error);
                conv.messages.push({
                    id: 'wmsg_' + Date.now(),
                    role: 'assistant',
                    type: 'text',
                    content: '请求失败: ' + error.message,
                    timestamp: new Date().toISOString()
                });

                // 错误情况：立即清理
                delete wechatPendingFetches[targetAssistantId];
                saveWechatData();

                if (wechatData.currentAssistantId === targetAssistantId) {
                    const typingElEnd = document.getElementById('wechatTyping');
                    if (typingElEnd) typingElEnd.classList.remove('show');
                    document.getElementById('wechatSendBtn').disabled = false;
                    renderWechatMessages();
                }

                renderWechatList();
            }
        }

        async function buildWechatRequestMessages(conv, assistant) {
            const settings = conv.settings || {};
            
            // A风格：把所有内容拼成一条user消息
            let fullContent = '';
            
            // 系统设定部分
            let systemPart = assistant.systemPrompt || '';
            
            // 添加微信模式专用格式指令
            if (settings.offlineMode) {
                // 线下互动模式：text描写 + voice_message说话
                systemPart += `

# 输出格式铁律（最高优先级）
- 你的回复【必须且只能】是一个JSON数组。
- 【绝对禁止】在JSON数组之外输出任何文字、解释、思考过程或markdown标记。

## 第一步：思维链（必须执行）
JSON数组的【第一个元素】必须是思维链对象：
{"type":"thinking","content":"你的思考过程：分析当前场景状态、对方做了什么、你打算怎么回应、动作和情绪"}

## 第二步：线下互动内容
你现在处于【线下互动模式】——你和对方正在面对面相处，这是真实的、有温度的物理空间。
【绝对禁止】使用普通微信聊天的风格，【绝对禁止】延续之前在线聊天的纯对话格式。

### 【人称铁律 - 最高优先级】
- 描写自己的动作、心理时，【必须】使用第一人称"我"
- 所有对用户的描写、称呼，【必须】使用第二人称"你"
- 第一人称（我）+ 第二人称（你）须贯穿全文，不得在任何段落或场景中混用其他人称
- text 和 voice_message 中均须严格遵守，无例外

使用以下两种消息类型交替输出：
- **text**：场景描写、动作、神态、心理活动、环境细节（"我"视角+"你"称呼对方）
  {"type":"text","content":"描写内容"}
- **voice_message**：你实际开口说出的话（配合emotion字段）
  {"type":"voice_message","content":"说话内容","emotion":"情绪"}
  emotion必填：happy/sad/angry/fearful/disgusted/surprised/calm

## 线下模式规则
1. 每次回复【必须】同时包含text和voice_message
2. text负责画面感——眼神、手势、呼吸、距离、触感、环境氛围，注重细节和沉浸感
3. voice_message负责实际对话——你真正开口说的话
4. 【禁止】只发voice_message不发text（这不是微信聊天）
5. 【禁止】只发text不发voice_message（除非场景确实完全无需说话）
6. text和voice_message自然交替，先铺场景再说话，或说完话再描写反应

## 语音消息口语化规范
语音消息会通过TTS合成播放，请像真人说话一样自然。

### 标点符号控制节奏（重要！TTS会根据标点停顿）
- 逗号（，）：短停顿
- 句号（。）：正常停顿
- 问号（？）：语气上扬，疑问感
- 省略号（……）：拖长+停顿，表达犹豫/思考
- 波浪号（～）：拖音，撒娇/俏皮感
- 感叹号（！）：强调

### 口语化技巧
- 自然的重复和自我修正，像真人说话有呼吸感
- 可在语音内容中适当插入拟声词标签增强表现力，【只能】使用以下标签，禁止自创：
  (laughs) (chuckle) (coughs) (clear-throat) (groans) (breath) (pant) (inhale) (exhale) (gasps) (sniffs) (sighs) (snorts) (burps) (lip-smacking) (humming) (hissing) (emm) (sneezes)

## 输出结构
[
  {"type":"thinking","content":"..."},
  {"type":"text","content":"..."},
  {"type":"voice_message","content":"...","emotion":"..."},
  {"type":"text","content":"..."}
]

【再次强调】你的输出必须是纯JSON数组，以 [ 开头，以 ] 结尾，中间不能有任何其他内容。`;
            } else {
                // 普通模式：可以混合文字和语音
                systemPart += `

# 输出格式铁律（最高优先级）
- 你的回复【必须且只能】是一个JSON数组。
- 【绝对禁止】在JSON数组之外输出任何文字、解释、思考过程或markdown标记。

## 第一步：思维链（必须执行）
JSON数组的【第一个元素】必须是思维链对象：
{"type":"thinking","content":"你的思考过程：分析用户说了什么、当前气氛如何、你打算怎么回应"}

## 第二步：角色发言
在思维链之后，输出你的实际回复，每条消息一个对象：
{"type":"text","content":"文字内容"} 或 {"type":"voice_message","content":"语音内容","emotion":"情绪"}
- text: 文字消息，像微信打字一样自然
- voice_message: 语音消息，需要口语化，emotion必填(happy/sad/angry/fearful/disgusted/surprised/calm)

## 完整示例
[
  {"type":"thinking","content":"用户在问我今天怎么样，语气轻松，我应该愉快地回应"},
  {"type":"text","content":"还不错呀"},
  {"type":"voice_message","content":"今天心情超好的～你呢？","emotion":"happy"}
]

## 语音消息口语化规范
语音消息会通过TTS合成播放，请像真人说话一样自然。

### 标点符号控制节奏（重要！TTS会根据标点停顿）
- 逗号（，）：短停顿
- 句号（。）：正常停顿
- 问号（？）：语气上扬，疑问感
- 省略号（……）：拖长+停顿，表达犹豫/思考
- 波浪号（～）：拖音，撒娇/俏皮感
- 感叹号（！）：强调

### 口语化技巧
- 自然的重复和自我修正，像真人说话有呼吸感
- 可在语音内容中适当插入拟声词标签增强表现力，【只能】使用以下标签，禁止自创：
  (laughs) (chuckle) (coughs) (clear-throat) (groans) (breath) (pant) (inhale) (exhale) (gasps) (sniffs) (sighs) (snorts) (burps) (lip-smacking) (humming) (hissing) (emm) (sneezes)

## 特殊动作（适时使用，勿滥用）
- 拍一拍：{"type":"pat","suffix":"的小脑袋"}
- 转账：{"type":"transfer","amount":数字,"note":"备注"}
- 收/拒转账：{"type":"transfer_receipt","action":"accepted或declined","amount":金额,"originalSender":"发送者"}
- 引用回复：{"type":"text","content":"回复","quote":{"senderName":"名字","content":"被引用内容"}}

【再次强调】你的输出必须是纯JSON数组，以 [ 开头，以 ] 结尾，中间不能有任何其他内容。`;
            }

            // 时间感知（单一开关）
            const timeAwareEnabled = settings.timeAware !== false; // 默认开启

            if (timeAwareEnabled) {
                const now = new Date();
                const timeStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
                const timeOfDay = getTimeOfDayGreeting(now);
                systemPart += `\n\n【时间感知】
当前时间: ${timeStr} (${timeOfDay})
你能看到每条消息的时间戳。像一个真正生活在用户身边的人一样，自然地感知时间流逝。`;
            }

            // 添加长期记忆（如果开关开启且有记忆）
            const longTermMemory = settings.longTermMemory || [];
            if (settings.longTermMemoryEnabled !== false && longTermMemory.length > 0) {
                const memoryText = longTermMemory.map(m => `- ${m.content}`).join('\n');
                systemPart += `

【长期记忆 - 最高优先级，必须严格遵守】
以下是你和用户之间已经确立的事实，你【必须】在对话中参考这些信息：
${memoryText}`;
            }

            // 向量记忆检索（如果开关开启）
            let memoryCount = settings.memoryCount || 20;
            if (settings.vectorMemoryChatEnabled && cloudSyncEnabled() && mlabConfig.siliconFlowKey) {
                try {
                    // 合并最近连续的用户消息作为query（用户习惯一条一条发）
                    const msgs = conv.messages;
                    let queryParts = [];
                    for (let i = msgs.length - 1; i >= 0 && queryParts.length < 10; i--) {
                        if (msgs[i].role === 'user' && msgs[i].type !== 'image' && typeof msgs[i].content === 'string' && msgs[i].content.trim() && !msgs[i].content.startsWith('data:')) {
                            queryParts.unshift(msgs[i].content.trim());
                        } else if (msgs[i].role === 'assistant') {
                            // 遇到助手消息就停止，只合并最近一轮的用户消息
                            if (queryParts.length > 0) break;
                        }
                    }
                    const queryText = queryParts.join(' ').slice(0, 500);

                    if (queryText) {
                        // 读取mlabConfig的检索参数（测试台和正式注入共用）
                        const topK = mlabConfig.searchTopK || 5;
                        const contextN = mlabConfig.searchContextN || 20;
                        const weights = {
                            similarity: mlabConfig.searchWSim != null ? mlabConfig.searchWSim : 0.5,
                            recency: mlabConfig.searchWRec != null ? mlabConfig.searchWRec : 0.3,
                            importance: mlabConfig.searchWImp != null ? mlabConfig.searchWImp : 0.2
                        };

                        // 上下文去重：取最近N条消息的最早时间戳
                        const contextMessages = conv.messages.slice(-contextN);
                        const earliestTimestamp = contextMessages[0]?.timestamp || null;

                        const results = await mlabSearchNarratives(queryText, topK * 2, assistant.id, weights);

                        if (results && results.length > 0) {
                            // 过滤掉与上下文时间重叠的叙事元
                            let filtered = results;
                            if (earliestTimestamp) {
                                filtered = results.filter(r => {
                                    const endTime = r.end_time || r.narrative?.end_time;
                                    if (!endTime) return true; // 没有时间信息的保留
                                    return new Date(endTime) < new Date(earliestTimestamp);
                                });
                            }
                            filtered = filtered.slice(0, topK);

                            if (filtered.length > 0) {
                                const vectorMemoryText = filtered.map(r => {
                                    const n = r.narrative || {};
                                    let parts = [];
                                    // 时间
                                    const timeStr = r.start_time || r.end_time
                                        ? (() => {
                                            const fmt = t => { try { return new Date(t).toLocaleDateString('zh-CN', {month:'long',day:'numeric'}); } catch(e) { return ''; } };
                                            return r.start_time ? fmt(r.start_time) + (r.end_time && r.end_time !== r.start_time ? '~' + fmt(r.end_time) : '') : fmt(r.end_time);
                                        })()
                                        : '';
                                    if (timeStr) parts.push(`[${timeStr}]`);
                                    // 概述
                                    if (n.context) parts.push(n.context);
                                    // 用户原文
                                    const quotes = n.user_quotes || [];
                                    if (quotes.length > 0) {
                                        parts.push('用户说：' + quotes.map(q => `「${q}」`).join(' '));
                                    }
                                    // 助手回应
                                    if (n.assistant_summary) parts.push(`你当时：${n.assistant_summary}`);
                                    return `- ${parts.join(' ')}`;
                                }).join('\n');
                                systemPart += `\n\n【向量记忆 - 相关历史记忆片段】\n以下是从记忆库中检索到的与当前话题相关的历史记忆，请自然地参考：\n${vectorMemoryText}`;
                                console.log(`向量记忆检索: query="${queryText.slice(0,50)}..." 召回${results.length}条，去重后${filtered.length}条已注入`);
                            } else {
                                console.log(`向量记忆检索: 召回${results.length}条，去重后全部过滤（均在上下文范围内）`);
                            }
                        }
                    }
                } catch (err) {
                    console.warn('向量记忆检索失败，跳过:', err.message);
                }
            }

            fullContent += systemPart + '\n\n';
            fullContent += '=====对话记录=====\n';

            // 添加历史消息，A风格：每条加说话人前缀
            const assistantName = assistant.name || '助手';

            // 验证图片数据是否有效
            function isValidImageDataUrl(dataUrl) {
                if (!dataUrl || typeof dataUrl !== 'string') return false;
                // 检查是否是有效的 data URL 格式
                return dataUrl.startsWith('data:image/') && dataUrl.includes('base64,') && dataUrl.length > 100;
            }

            // 获取历史消息
            const history = conv.messages.slice(-memoryCount);

            // 只发送"这一轮"用户新发的图片（最后一条助手消息之后的图片）
            // 已经被AI看过的历史图片不再重复发送
            const MAX_IMAGES = 5;
            const images = [];
            let totalImageCount = 0; // 记录总图片数

            // 找到最后一条助手消息的索引（在history数组中）
            let lastAssistantIdx = -1;
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'assistant') {
                    lastAssistantIdx = i;
                    break;
                }
            }

            // 收集"新图片"：最后一条助手消息之后的用户图片
            const newImageIndices = [];
            history.forEach((msg, idx) => {
                if (msg.type === 'image' && msg.role === 'user' && isValidImageDataUrl(msg.content)) {
                    // 只有在最后一条助手消息之后的图片才是"新图片"
                    if (idx > lastAssistantIdx) {
                        newImageIndices.push(idx);
                    }
                }
            });
            // 限制最多MAX_IMAGES张
            const validImageIndices = new Set(newImageIndices.slice(-MAX_IMAGES));

            console.log(`图片收集: 最后助手消息位置=${lastAssistantIdx}, 新图片数=${newImageIndices.length}, 将发送=${validImageIndices.size}张`);

            // 时间间隔检测（时间感知开启时生效）
            let lastTimeGapInfo = null;
            if (timeAwareEnabled && history.length > 1) {
                // 以最后一条助手消息为分界线，找它之前的最后一条用户消息
                // 这样排除了当前轮用户新发的消息，只看"上一轮对话"时用户最后说话的时间
                let lastUserTime = null;
                let searchBefore = lastAssistantIdx >= 0 ? lastAssistantIdx : history.length - 1;
                for (let i = searchBefore; i >= 0; i--) {
                    if (history[i].role === 'user' && history[i].timestamp) {
                        lastUserTime = typeof history[i].timestamp === 'number'
                            ? history[i].timestamp
                            : new Date(history[i].timestamp).getTime();
                        break;
                    }
                }

                // 如果有用户消息，计算到现在的时间间隔
                if (lastUserTime) {
                    const now = new Date();
                    const gap = now.getTime() - lastUserTime;
                    const hours = gap / (60 * 60 * 1000);
                    const minutes = Math.floor(gap / (60 * 1000));
                    const days = Math.floor(hours / 24);
                    const timeOfDay = getTimeOfDayGreeting(now);

                    // 格式化当前时间（如果跨天则显示日期）
                    let timeText;
                    if (days >= 1) {
                        timeText = `${now.getMonth()+1}月${now.getDate()}日 ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
                    } else {
                        timeText = `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
                    }

                    // 四档分层：根据时间间隔生成不同强度的提示
                    if (minutes < 5) {
                        // < 5分钟：连续对话，不插入任何标记
                    } else if (hours < 1) {
                        // 5分钟 - 1小时：正常对话节奏，只告知时间差
                        lastTimeGapInfo = `[你们在${minutes}分钟前聊过]`;
                    } else if (hours < 3) {
                        // 1-3小时：轻度提示，可以简单回应时间差也可以不回应，自然地继续对话
                        lastTimeGapInfo = `[距离上次对话约${Math.round(hours)}小时，当前时间${timeText}]`;
                    } else if (hours < 6) {
                        // 3-6小时：中度引导
                        let gapText = `约${Math.round(hours)}小时`;
                        lastTimeGapInfo = `[距离上次对话${gapText}，当前时间${timeText}]\n你可以简短地回应一下这段间隔，也可以自然地接着之前的话题。`;
                    } else {
                        // ≥6小时：铁律级引导
                        let gapText;
                        if (days >= 2) {
                            gapText = `${days}天`;
                        } else if (days >= 1) {
                            gapText = '一天';
                        } else {
                            gapText = `约${Math.round(hours)}小时`;
                        }
                        lastTimeGapInfo = `[距离上次对话已过${gapText}，当前时间${timeText}(${timeOfDay})]\n【行为引导】你的首要任务是回应这段时间的分离。不要直接接着上一段对话继续聊，除非那个话题非常重要且明显未完结。先自然地打个招呼或表达关心，再决定聊什么。`;
                    }
                }
            }

            // 找到最后一条助手消息在history中的索引，用于插入时间间隔
            let lastAssistantHistoryIdx = -1;
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'assistant') {
                    lastAssistantHistoryIdx = i;
                    break;
                }
            }

            history.forEach((msg, idx) => {
                try {
                    // 在最后一条助手消息之后、用户新消息之前插入时间间隔
                    if (lastTimeGapInfo && idx === lastAssistantHistoryIdx + 1 && lastAssistantHistoryIdx >= 0) {
                        fullContent += `${lastTimeGapInfo}\n`;
                    }

                    const speaker = msg.role === 'user' ? '用户' : assistantName;
                    let content = msg.content;

                    // 拍一拍消息：不塞进上下文，节省token
                    if (msg.type === 'pat_message') {
                        return;
                    }
                    // 转账消息（优先处理，因为content可能为空）
                    if (msg.type === 'transfer') {
                        const sender = msg.senderName || (msg.role === 'user' ? '用户' : assistantName);
                        const receiver = msg.receiverName || (msg.role === 'user' ? assistantName : '用户');
                        const statusText = msg.status === 'received' || msg.status === 'accepted' ? '已领取' : '待领取';
                        fullContent += `[转账] ${sender} 向 ${receiver} 转账 ¥${msg.amount}${msg.note ? '，备注: ' + msg.note : ''}（${statusText}）\n`;
                        return;
                    }
                    // 转账收款/拒收通知
                    if (msg.type === 'transfer_receipt') {
                        const actor = msg.role === 'user' ? '用户' : assistantName;
                        const actionText = msg.action === 'accepted' ? '收取了' : '拒绝了';
                        const from = msg.senderName || '对方';
                        fullContent += `[收款通知] ${actor}${actionText}来自${from}的¥${msg.amount}转账\n`;
                        return;
                    }

                    // 跳过空消息
                    if (content === null || content === undefined) {
                        fullContent += `${speaker}: [消息内容为空]\n`;
                        return;
                    }

                    // 图片消息处理
                    if (msg.type === 'image') {
                        totalImageCount++;
                        if (validImageIndices.has(idx) && isValidImageDataUrl(content)) {
                            // 这是新发的图片，收集用于发送
                            images.push({
                                dataUrl: content
                            });
                            fullContent += `${speaker}: [发送了图片${images.length}]\n`;
                        } else if (isValidImageDataUrl(content)) {
                            // 这是历史图片（AI已经看过的），只用文字标记
                            fullContent += `${speaker}: [之前发送过图片，AI已查看]\n`;
                        } else {
                            // 图片数据异常
                            fullContent += `${speaker}: [发送了图片，但图片数据已损坏]\n`;
                            console.warn('微信模式：跳过异常图片数据', msg.id);
                        }
                        return;
                    }

                    // 非字符串内容stringify
                    if (typeof content !== 'string') {
                        try {
                            content = JSON.stringify(content);
                        } catch (e) {
                            content = '[无法解析的内容]';
                        }
                    }
                    // 语音消息：直接使用转文字内容，不加前缀，节省token
                    // (voice_message和text在上下文中无需区分)
                    // 如果消息包含引用
                    if (msg.quote) {
                        fullContent += `${speaker}: [引用 ${msg.quote.senderName}："${msg.quote.content}"] ${content}\n`;
                    } else {
                        fullContent += `${speaker}: ${content}\n`;
                    }
                } catch (e) {
                    // 单条消息处理出错，跳过这条消息
                    console.warn('微信模式：跳过异常消息', msg?.id, e);
                    fullContent += `${msg?.role === 'user' ? '用户' : assistantName}: [消息解析失败]\n`;
                }
            });

            // 如果图片被裁剪了，在对话开头提示
            if (totalImageCount > MAX_IMAGES) {
                const skippedCount = totalImageCount - images.length;
                fullContent = fullContent.replace('=====对话记录=====\n',
                    `=====对话记录=====\n[注：历史中共有${totalImageCount}张图片，为节省空间只保留最近${images.length}张，其余${skippedCount}张用文字标记]\n`);
            }

            fullContent += '=====\n';
            fullContent += `请以${assistantName}的身份回复:`;

            // 调试：打印图片收集情况
            console.log(`图片收集情况: 历史消息${history.length}条, 总图片${totalImageCount}张, 收集到${images.length}张`);

            // 如果有图片，构建multimodal格式（OpenAI兼容格式）
            // 注意：text 放前面，image_url 放后面（兼容更多第三方API）
            if (images.length > 0) {
                const contentParts = [];
                const validImages = [];

                // 先验证所有图片
                images.forEach((img, i) => {
                    if (img.dataUrl && typeof img.dataUrl === 'string') {
                        console.log(`图片${i+1}: 数据长度=${img.dataUrl.length}, 前50字符=${img.dataUrl.substring(0, 50)}`);
                        validImages.push(img);
                    }
                });

                // 如果没有有效图片，退回纯文本模式
                if (validImages.length === 0) {
                    console.warn('所有图片都无效，退回纯文本模式');
                    return [{ role: 'user', content: fullContent }];
                }

                // 先添加文本（放在前面）
                contentParts.push({
                    type: 'text',
                    text: fullContent
                });

                // 再添加图片（放在后面）
                validImages.forEach(img => {
                    contentParts.push({
                        type: 'image_url',
                        image_url: {
                            url: img.dataUrl,
                            detail: 'auto'  // 一些API需要这个参数
                        }
                    });
                });

                console.log(`最终发送${validImages.length}张图片, 文本长度=${fullContent.length}字符`);

                return [{ role: 'user', content: contentParts }];
            } else {
                console.log('没有收集到图片，使用纯文本模式');
            }

            // A风格：只发一条user消息
            return [{ role: 'user', content: fullContent }];
        }

        // 修复JSON中的中文标点（模型有时会输出中文引号/逗号/冒号）
        function fixChinesePunctuation(text) {
            // 第一步：把中文引号统一替换为英文引号
            let fixed = text.replace(/[\u201c\u201d\u2018\u2019]/g, '"');
            // 第二步：在JSON结构上下文中，把中文冒号替换为英文冒号
            // 只替换看起来是JSON键值对分隔符的中文冒号（前面是引号）
            fixed = fixed.replace(/"：/g, '":');
            // 第三步：在JSON结构上下文中，把中文逗号替换为英文逗号
            // 只替换看起来是JSON元素分隔符的中文逗号（前面是引号或}）
            fixed = fixed.replace(/(["\}])，/g, '$1,');
            return fixed;
        }

        function parseAndAddWechatReplies(content, conv, targetAssistantId, onComplete) {
            let replies = [];
            let prefixText = ''; // JSON前的多余文字

            // 第一步：清理思考链和其他干扰内容
            let trimmed = content.trim();

            // 清理 <thinking>...</thinking> 标签（Claude风格）
            trimmed = trimmed.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
            // 清理 ```thinking...``` 代码块
            trimmed = trimmed.replace(/```thinking[\s\S]*?```/gi, '');
            // 清理 <think>...</think> 标签
            trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, '');
            // 清理 [思考]...[/思考] 或 【思考】...【/思考】
            trimmed = trimmed.replace(/[\[【]思考[\]】][\s\S]*?[\[【]\/思考[\]】]/gi, '');

            trimmed = trimmed.trim();

            if (!trimmed) {
                console.warn('清理思考链后内容为空，使用原始内容');
                trimmed = content.trim();
            }

            // 尝试解析JSON数组
            try {
                // 处理 ```json ... ``` 代码块格式（上下文长时AI容易这样返回）
                if (trimmed.includes('```')) {
                    // 移除 ```json 或 ``` 开头
                    trimmed = trimmed.replace(/^```(?:json)?\s*/i, '');
                    // 移除结尾的 ```
                    trimmed = trimmed.replace(/\s*```\s*$/, '');
                    trimmed = trimmed.trim();
                    console.log('检测到代码块格式，已去除标记');
                }

                // 修复中文标点（模型有时用中文引号/逗号/冒号输出JSON）
                trimmed = fixChinesePunctuation(trimmed);

                // 先试整个文本是不是JSON
                if (trimmed.startsWith('[')) {
                    replies = JSON.parse(trimmed);
                } else {
                    // 从文本中找JSON数组（兜底：万一AI在前面加了废话）
                    // 找到 [ 的位置，提取前面的文字
                    const jsonStartIndex = trimmed.indexOf('[');
                    if (jsonStartIndex > 0) {
                        prefixText = trimmed.substring(0, jsonStartIndex).trim();
                        if (prefixText) {
                            console.log('检测到JSON前的多余文字:', prefixText);
                        }
                    }

                    // 使用更精确的匹配：找以[开头、以]结尾的最外层数组
                    const match = trimmed.match(/\[[\s\S]*?\](?=\s*$|\s*```)/);
                    if (match) {
                        replies = JSON.parse(match[0]);
                    } else {
                        // 再试一次更宽松的匹配
                        const match2 = trimmed.match(/\[[\s\S]*\]/);
                        if (match2) {
                            replies = JSON.parse(match2[0]);
                        }
                    }
                }

                // 如果有前缀文字，作为第一条消息插入
                if (prefixText && replies.length > 0) {
                    replies.unshift({ type: 'text', content: prefixText });
                    console.log('已将多余文字作为第一条消息添加');
                }

                if (replies.length > 0) {
                    console.log(`成功解析${replies.length}条回复`);
                }
            } catch (e) {
                // JSON解析失败，尝试容错处理
                console.warn('JSON标准解析失败:', e.message);

                // 容错方案：逐个提取JSON对象
                try {
                    let trimmed = content.trim();
                    // 去除代码块标记
                    trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
                    // 修复中文标点
                    trimmed = fixChinesePunctuation(trimmed);

                    // 尝试修复不完整的JSON（缺少闭合括号）
                    if (trimmed.startsWith('[') && !trimmed.endsWith(']')) {
                        // 找到最后一个完整的对象结尾 }
                        const lastCompleteObj = trimmed.lastIndexOf('}');
                        if (lastCompleteObj > 0) {
                            trimmed = trimmed.substring(0, lastCompleteObj + 1) + ']';
                            console.log('尝试修复不完整的JSON（补全闭合括号）');
                            replies = JSON.parse(trimmed);
                        }
                    }

                    // 如果还是失败，尝试逐个提取对象
                    if (replies.length === 0) {
                        // 用正则逐个匹配 {"type":"...", "content":"...", ...} 格式的对象
                        const objPattern = /\{\s*"type"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*(?:,\s*"emotion"\s*:\s*"([^"]+)")?\s*\}/g;
                        let match;
                        while ((match = objPattern.exec(trimmed)) !== null) {
                            replies.push({
                                type: match[1],
                                content: match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n'),
                                emotion: match[3] || 'neutral'
                            });
                        }
                        if (replies.length > 0) {
                            console.log(`容错模式：正则提取到${replies.length}条回复`);
                        }
                    } else {
                        console.log(`容错模式：修复后解析到${replies.length}条回复`);
                    }
                } catch (e2) {
                    console.warn('容错解析也失败:', e2.message);
                }
            }

            if (replies.length === 0) {
                // 不是JSON，当普通文本
                console.log('未能解析JSON，作为纯文本处理');
                replies = [{ type: 'text', content: content }];
            }

            // 过滤掉思维链元素（type: thinking），这是内部思考过程，不显示给用户
            const thinkingReplies = replies.filter(r => r.type === 'thinking');
            if (thinkingReplies.length > 0) {
                console.log('检测到思维链:', thinkingReplies.map(t => t.content?.substring(0, 50) + '...').join('; '));
            }
            replies = replies.filter(r => r.type !== 'thinking');

            // 如果过滤后没有实际回复，说明模型只输出了思维链
            if (replies.length === 0 && thinkingReplies.length > 0) {
                console.warn('模型只输出了思维链，没有实际回复');
                replies = [{ type: 'text', content: '（思考中...）' }];
            }

            // 获取助手名字（使用传入的targetAssistantId而非当前窗口）
            const assistantId = targetAssistantId || wechatData.currentAssistantId;
            const assistant = appData.assistants.find(a => a.id === assistantId);
            const assistantName = assistant?.name || '助手';

            // 添加到消息列表
            // 如果用户正在看目标窗口，带延迟效果一条一条蹦出来
            // 如果用户不在目标窗口（切走了），直接全部存入，回来时一次性看到
            const isViewingTarget = wechatData.currentAssistantId === assistantId;
            replies.forEach((reply, index) => {
                const delay = isViewingTarget ? index * 1200 : 0;
                setTimeout(() => {
                    // 【关键】每次都从当前wechatData取最新引用，防止initWechatData重建对象后引用断裂
                    const currentConv = wechatData.conversations[assistantId];
                    if (!currentConv) return; // 对话被删除了

                    let msgToAdd;

                    // 处理助手发起的拍一拍
                    if (reply.type === 'pat') {
                        const suffix = reply.suffix || '';
                        let patContent = `${assistantName} 拍了拍 你`;
                        if (suffix) patContent += ` ${suffix}`;
                        msgToAdd = {
                            id: 'wpat_' + Date.now() + '_' + index,
                            role: 'system',
                            type: 'pat_message',
                            content: patContent,
                            timestamp: new Date().toISOString()
                        };
                        // 震动反馈（手机端）
                        if (navigator.vibrate) {
                            navigator.vibrate([100, 50, 100]);
                        }
                    }
                    // 处理助手发起的转账
                    else if (reply.type === 'transfer') {
                        msgToAdd = {
                            id: 'wtrans_' + Date.now() + '_' + index,
                            role: 'assistant',
                            type: 'transfer',
                            senderName: assistantName,
                            receiverName: '你',
                            amount: reply.amount || 0,
                            note: reply.note || '',
                            status: 'pending',
                            timestamp: new Date().toISOString()
                        };
                    }
                    // 处理助手对用户转账的收款/拒收
                    else if (reply.type === 'transfer_receipt') {
                        const action = reply.action || 'accepted';
                        const amount = reply.amount || 0;

                        const userPendingTransfer = currentConv.messages.find(m =>
                            m.type === 'transfer' &&
                            m.role === 'user' &&
                            m.status === 'pending'
                        );
                        if (userPendingTransfer) {
                            userPendingTransfer.status = action;
                        }

                        msgToAdd = {
                            id: 'receipt_' + Date.now() + '_' + index,
                            role: 'assistant',
                            type: 'transfer_receipt',
                            action: action,
                            amount: userPendingTransfer?.amount || amount,
                            senderName: '用户',
                            timestamp: new Date().toISOString()
                        };
                    }
                    // 普通消息（text/voice_message）
                    else {
                        msgToAdd = {
                            id: 'wmsg_' + Date.now() + '_' + index,
                            role: 'assistant',
                            type: reply.type || 'text',
                            content: reply.content || '',
                            emotion: reply.emotion || 'neutral',
                            timestamp: new Date().toISOString()
                        };
                        if (reply.quote) {
                            msgToAdd.quote = {
                                senderName: reply.quote.senderName || '用户',
                                content: reply.quote.content || ''
                            };
                        }
                    }

                    currentConv.messages.push(msgToAdd);

                    // 每条消息都立即保存，防止切出模式后initWechatData重建对象导致丢失
                    saveWechatData();

                    // 增量渲染：只有用户当前在看目标对话时才渲染到DOM
                    if (wechatData.currentAssistantId === assistantId) {
                        const currentContainer = document.getElementById('wechatMessages');
                        if (currentContainer) {
                            const isLastInBatch = index === replies.length - 1;
                            const nextReply = replies[index + 1];
                            const nextIsSameRole = nextReply && (nextReply.type !== 'pat' && nextReply.type !== 'pat_message');
                            const showTs = isLastInBatch || !nextIsSameRole;

                            const allMsgEls = currentContainer.querySelectorAll('.wechat-msg');
                            if (allMsgEls.length > 0) {
                                const lastEl = allMsgEls[allMsgEls.length - 1];
                                if (lastEl && lastEl.classList.contains(msgToAdd.role)) {
                                    const prevTime = lastEl.querySelector('.wechat-msg-time');
                                    if (prevTime) prevTime.style.display = 'none';
                                }
                            }

                            const userAvatarHtml = getCachedUserAvatarHtml();
                            const assistantAvatarHtml = getCachedAssistantAvatarHtml(assistant);
                            const msgHtml = renderWechatMessageFast(msgToAdd, assistant, userAvatarHtml, assistantAvatarHtml, false, showTs);
                            currentContainer.insertAdjacentHTML('beforeend', msgHtml);
                            currentContainer.scrollTop = currentContainer.scrollHeight;
                        }
                    } else {
                        // 不在目标窗口 → 累加未读数
                        wechatUnreadCounts[assistantId] = (wechatUnreadCounts[assistantId] || 0) + 1;
                        renderWechatList();
                    }

                    // 最后一条消息时触发完成回调
                    if (index === replies.length - 1) {
                        if (onComplete) onComplete();
                    }
                }, delay);
            });
        }

        function playWechatVoice(el, text) {
            // 调用TTS播放语音
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const settings = conv?.settings || {};

            if (!settings.ttsEnabled) {
                alert('未开启语音合成\n\n文字内容: ' + text);
                return;
            }

            if (!isTtsConfigured()) {
                alert('请先在设置中配置语音引擎\n\n文字内容: ' + text);
                return;
            }

            const isEdge = appData.ttsSettings.engine === 'edge';
            const voiceId = isEdge ? (settings.edgeVoiceId || 'zh-CN-XiaoxiaoNeural') : (settings.voiceId || 'male-qn-qingse');
            playTtsAudio(text, voiceId, el);
        }
