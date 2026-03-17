/**
 * API模式发送消息
 *
 * 负责：sendMessage、streamChat、buildMessages、buildRequestBody、processStreamResponse
 * 暴露函数/变量：isSending, sendMessage, streamChat, buildMessages,
 *                 buildRequestBody, processStreamResponse
 * 依赖：appData/thinkingConfig(data.js), saveData(storage.js),
 *        renderMessages/scheduleStreamRender/createNewConversation/renderConversationList/updateChatHeader(api-chat.js),
 *        pendingFiles/clearPendingFiles/buildMultimodalContent(file-upload.js)
 */

        // ==================== 发送消息 ====================
        let isSending = false; // 防止并发发送

        async function sendMessage() {
            if (isSending) return; // 防止重复发送

            const input = document.getElementById('chatInput');
            const content = input.value.trim();

            // 需要有文本或文件才能发送
            if (!content && pendingFiles.length === 0) return;
            if (!appData.currentAssistantId) {
                alert('请先选择一个助手');
                return;
            }

            if (!appData.currentConversationId) {
                createNewConversation();
            }

            const assistant = appData.assistants.find(a => a.id === appData.currentAssistantId);

            // 获取当前使用的模型：对话临时模型 > 助手默认模型 > 全局默认模型
            const conv = appData.conversations.find(c => c.id === appData.currentConversationId);
            const tempModel = appData.settings.apiTempModel; // API模式全局临时模型
            const assistantModel = assistant.providerId && assistant.modelId ? `${assistant.providerId}||${assistant.modelId}` : '';
            const globalModel = appData.settings.defaultModel;
            const modelValue = tempModel || assistantModel || globalModel;

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

            // 标记发送中，禁用按钮
            isSending = true;
            const chatSendBtn = document.getElementById('chatSendBtn');
            chatSendBtn.disabled = true;

            // 临时覆盖assistant的模型（用于本次请求）
            const effectiveAssistant = { ...assistant, providerId, modelId };

            // 处理文件附件
            const filesToSend = [...pendingFiles];
            const hasFiles = filesToSend.length > 0;

            // 构建消息内容（用于API请求）
            const apiContent = hasFiles ? buildMultimodalContent(content, filesToSend) : content;

            // 构建用于显示的内容
            const displayContent = content;

            // 保存文件预览信息（仅保存图片的base64用于显示）
            const attachments = filesToSend.map(f => ({
                name: f.name,
                isImage: f.isImage,
                preview: f.isImage ? f.base64 : null
            }));

            const userMsg = {
                id: 'msg_' + Date.now(),
                role: 'user',
                content: displayContent,
                apiContent: apiContent, // 用于API请求的内容（可能是multimodal格式）
                attachments: attachments, // 附件信息
                versions: [displayContent],
                currentVersion: 0,
                timestamp: new Date().toISOString()
            };

            const convId = appData.currentConversationId; // 锁定当前对话ID，防止切换对话后写错地方

            try {
                appData.messages[convId].push(userMsg);
                input.value = '';
                input.style.height = 'auto';
                clearPendingFiles(); // 清空待发送文件
                renderMessages();

                if (appData.messages[convId].length === 1) {
                    const conv = appData.conversations.find(c => c.id === convId);
                    conv.title = content.substring(0, 20) + (content.length > 20 ? '...' : '');
                    renderConversationList();
                    updateChatHeader();
                }

                // 用户消息推入后立即存盘，防止流式期间丢消息
                saveData();

                const aiMsg = {
                    id: 'msg_' + Date.now() + '_ai',
                    role: 'assistant',
                    content: '',
                    versions: [''],
                    currentVersion: 0,
                    reasoningText: '',
                    timestamp: new Date().toISOString(),
                    isStreaming: true
                };
                appData.messages[convId].push(aiMsg);
                renderMessages();

                await streamChat(provider, effectiveAssistant, aiMsg);
                aiMsg.versions[0] = aiMsg.content;
                aiMsg.isStreaming = false;

                if (conv) {
                    conv.updatedAt = new Date().toISOString();
                }
            } catch (error) {
                console.error('请求失败:', error);
                // 找到最后一条AI消息并写入错误信息
                const msgs = appData.messages[convId];
                const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : null;
                if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                    // 如果已经收到了正文内容，不要覆盖，只标记结束
                    if (lastMsg.content && lastMsg.content.trim().length > 0) {
                        console.warn('流式传输出错但已有内容，保留正文:', error.message);
                        lastMsg.versions[0] = lastMsg.content; // 同步versions
                    } else {
                        lastMsg.content = '请求失败：' + error.message;
                        lastMsg.versions[0] = lastMsg.content;
                    }
                    lastMsg.isStreaming = false;
                }
            } finally {
                // 无论成功失败，都恢复按钮和保存数据
                isSending = false;
                chatSendBtn.disabled = false;
                saveData();
                renderMessages();
            }
        }

        async function streamChat(provider, assistant, aiMsg) {
            const messages = buildMessages(assistant);

            const requestBody = buildRequestBody(assistant, messages);

            const response = await fetch(provider.baseUrl + provider.apiPath, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + provider.apiKey
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            if (appData.settings.apiStreamEnabled === false) {
                const data = await response.json();
                aiMsg.content = data.choices[0].message.content;
                if (data.usage) aiMsg.totalTokens = data.usage.total_tokens;
                return;
            }

            await processStreamResponse(response, aiMsg);
        }

        function buildMessages(assistant) {
            const messages = [];
            const MAX_IMAGES = 5; // 限制最多5张图片，防止请求体过大

            // 系统提示词
            let systemContent = assistant.systemPrompt || '';
            // 注入当前时间
            if (assistant.memoryEnabled && assistant.memories && assistant.memories.length > 0) {
                systemContent += '\n\n【记忆】\n' + assistant.memories.join('\n');
            }
            if (systemContent) {
                messages.push({ role: 'system', content: systemContent });
            }

            // 验证图片数据是否有效
            function isValidImageDataUrl(dataUrl) {
                if (!dataUrl || typeof dataUrl !== 'string') return false;
                return dataUrl.startsWith('data:image/') && dataUrl.includes('base64,') && dataUrl.length > 100;
            }

            // 统计消息中的图片数量
            function countImages(content) {
                if (!Array.isArray(content)) return 0;
                return content.filter(part => part.type === 'image_url' && part.image_url?.url).length;
            }

            // 历史消息
            const history = appData.messages[appData.currentConversationId].slice(0, -1);
            const contextLength = appData.settings.apiContextLength || 20;
            const historySlice = history.slice(-contextLength);

            // 第一遍：统计所有图片，确定哪些消息的图片可以保留
            let totalImages = 0;
            const msgImageInfo = historySlice.map((m, idx) => {
                const content = m.apiContent || m.content;
                const count = Array.isArray(content) ? countImages(content) : 0;
                totalImages += count;
                return { idx, count, hasImages: count > 0 };
            });

            // 从后往前保留图片，直到达到MAX_IMAGES
            let remainingQuota = MAX_IMAGES;
            const allowedImageMsgIndices = new Set();
            for (let i = msgImageInfo.length - 1; i >= 0 && remainingQuota > 0; i--) {
                if (msgImageInfo[i].hasImages) {
                    if (msgImageInfo[i].count <= remainingQuota) {
                        allowedImageMsgIndices.add(msgImageInfo[i].idx);
                        remainingQuota -= msgImageInfo[i].count;
                    }
                }
            }

            // 清理和验证multimodal内容（带图片配额控制）
            function sanitizeContent(content, msgIdx) {
                // 如果是字符串，直接返回
                if (typeof content === 'string') {
                    return content || '[空消息]';
                }
                // 如果是数组（multimodal格式），验证并过滤
                if (Array.isArray(content)) {
                    const validParts = [];
                    let hasText = false;
                    let skippedImages = 0;
                    const canIncludeImages = allowedImageMsgIndices.has(msgIdx);

                    for (const part of content) {
                        try {
                            if (part.type === 'text') {
                                validParts.push(part);
                                hasText = true;
                            } else if (part.type === 'image_url' && part.image_url?.url) {
                                if (canIncludeImages && isValidImageDataUrl(part.image_url.url)) {
                                    validParts.push(part);
                                } else if (isValidImageDataUrl(part.image_url.url)) {
                                    // 图片有效但配额不足，跳过
                                    skippedImages++;
                                } else {
                                    console.warn('API模式：跳过异常图片数据');
                                }
                            }
                        } catch (e) {
                            console.warn('API模式：跳过异常内容块', e);
                        }
                    }

                    // 如果跳过了图片，在文本中标记
                    if (skippedImages > 0) {
                        const existingText = validParts.find(p => p.type === 'text');
                        if (existingText) {
                            existingText.text = `[此消息原有${skippedImages}张图片已省略] ` + existingText.text;
                        } else {
                            validParts.push({ type: 'text', text: `[此消息有${skippedImages}张图片已省略]` });
                            hasText = true;
                        }
                    }

                    // 如果过滤后没有内容，返回占位文本
                    if (validParts.length === 0) {
                        return '[消息内容已损坏]';
                    }
                    // 如果只剩文本，直接返回文本字符串
                    if (validParts.length === 1 && validParts[0].type === 'text') {
                        return validParts[0].text || '[空消息]';
                    }
                    // 确保有文本部分
                    if (!hasText) {
                        validParts.push({ type: 'text', text: '请查看图片' });
                    }
                    return validParts;
                }
                // 其他类型尝试转字符串
                try {
                    return JSON.stringify(content) || '[未知格式消息]';
                } catch (e) {
                    return '[无法解析的消息]';
                }
            }

            // 第二遍：构建消息
            historySlice.forEach((m, idx) => {
                try {
                    const rawContent = m.apiContent || m.content;
                    const msgContent = sanitizeContent(rawContent, idx);
                    messages.push({ role: m.role, content: msgContent });
                } catch (e) {
                    // 单条消息处理出错，添加占位消息
                    console.warn('API模式：跳过异常消息', m?.id, e);
                    messages.push({ role: m.role || 'user', content: '[消息解析失败]' });
                }
            });

            // 把当前时间加到最后一条 user 消息里（避免污染 system prompt 导致缓存不命中）
            const now = new Date();
            const timeStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
            const weekDays = ['日','一','二','三','四','五','六'];
            const timeLine = `【当前时间】${timeStr} 星期${weekDays[now.getDay()]}`;
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                    if (typeof messages[i].content === 'string') {
                        messages[i].content = timeLine + '\n' + messages[i].content;
                    } else if (Array.isArray(messages[i].content)) {
                        const textPart = messages[i].content.find(p => p.type === 'text');
                        if (textPart) textPart.text = timeLine + '\n' + textPart.text;
                        else messages[i].content.unshift({ type: 'text', text: timeLine });
                    }
                    break;
                }
            }

            return messages;
        }

        function buildRequestBody(assistant, messages) {
            const level = appData.settings.thinkingLevel || 'medium';
            const thinkingTokens = thinkingConfig[level].tokens;

            const requestBody = {
                model: assistant.modelId,
                messages: messages,
                temperature: assistant.temperature || 1,
                stream: appData.settings.apiStreamEnabled !== false
            };

            requestBody.max_tokens = (assistant.maxTokens > 0) ? assistant.maxTokens : 30000;

            // 根据思考级别设置（兼容多种供应商格式）
            if (level !== 'off' && level !== 'auto' && thinkingTokens > 0) {
                requestBody.max_thinking_tokens = thinkingTokens;
                requestBody.reasoning = { max_tokens: thinkingTokens };
                requestBody.reasoning_effort = level === 'low' ? 'low' : level === 'high' ? 'high' : 'medium';
                requestBody.thinking = { type: 'enabled', budget_tokens: thinkingTokens };
                requestBody.include_reasoning = true;
            }

            return requestBody;
        }

        async function processStreamResponse(response, aiMsg) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let thinkingStartTime = Date.now();
            let isThinking = false;
            const STREAM_TIMEOUT = 120000; // 2分钟超时，防止网络半断开时永远挂起
            let streamDone = false;

            while (true) {
                // 带超时的读取，防止卡死
                const readPromise = reader.read();
                let timeoutId;
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('流式响应超时（2分钟无数据）')), STREAM_TIMEOUT);
                });

                let result;
                try {
                    result = await Promise.race([readPromise, timeoutPromise]);
                    clearTimeout(timeoutId); // 读取成功，清除超时定时器
                } catch (timeoutError) {
                    reader.cancel();
                    // 如果已经收到[DONE]或已有内容，不抛错，正常结束
                    if (streamDone || aiMsg.content.length > 0) {
                        console.log('流式读取超时，但内容已完整接收，正常结束');
                        break;
                    }
                    throw timeoutError;
                }

                const { done, value } = result;
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            streamDone = true;
                            continue;
                        }

                        try {
                            const json = JSON.parse(data);
                            const delta = json.choices?.[0]?.delta;

                            if (delta) {
                                const thinkingText = delta.reasoning_content || delta.reasoning;
                                if (thinkingText) {
                                    if (!isThinking) {
                                        isThinking = true;
                                        thinkingStartTime = Date.now();
                                    }
                                    aiMsg.reasoningText += thinkingText;
                                }

                                if (delta.content) {
                                    if (isThinking) {
                                        isThinking = false;
                                        aiMsg.thinkingDuration = ((Date.now() - thinkingStartTime) / 1000).toFixed(1) + 's';
                                    }
                                    aiMsg.content += delta.content;
                                }

                                scheduleStreamRender();
                            }

                            if (json.usage) {
                                aiMsg.totalTokens = json.usage.total_tokens;
                            }
                        } catch (e) {}
                    }
                }

                // 收到[DONE]后立即退出while循环，不再等待reader.read()
                if (streamDone) break;
            }
        }
