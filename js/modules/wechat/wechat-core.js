/**
 * 微信模式 - 核心
 *
 * 负责：wechatData 数据定义、初始化/存储、联系人列表渲染、打开聊天、
 *        输入框设置、头像缓存、消息渲染(分页)
 * 暴露函数/变量：wechatData, initWechatData, saveWechatData, openWechatMode,
 *                 closeWechatMode, renderWechatList, openWechatChat, backToWechatList,
 *                 renderWechatMessages, getCachedUserAvatarHtml, getCachedAssistantAvatarHtml,
 *                 wechatPendingFetches, wechatUnreadCounts, editingWechatMessageId,
 *                 WECHAT_PAGE_SIZE, wechatCurrentPage, wechatKeepScrollPosition
 * 依赖：appData(data.js), saveToIndexedDB/loadFromIndexedDB/dbInstance(storage.js),
 *        openPage/closePage(navigation.js), escapeHtml(ui.js), formatTimeShort(time.js),
 *        formatMessageContent(markdown.js), stripInterjectionsAlways(tts.js),
 *        formatWechatDate(time.js), startProactiveTimer/stopProactiveTimer(proactive.js),
 *        mlabStartAutoTimer/mlabStopAutoTimer(memory-lab.js),
 *        applyWechatTheme/applyBubbleOpacity/applyWechatPattern(wechat-settings.js),
 *        _cloudSyncDirty(cloud-sync.js)
 */

        // ==================== 微信模式 ====================
        let wechatData = {
            currentAssistantId: null,
            importedAssistants: [],  // 已导入到微信模式的助手ID列表
            conversations: {},  // { assistantId: { messages: [], settings: {} } }
            pendingMessages: [] // 暂存的消息
        };
        let _wechatDataLoaded = false;

        let wechatPendingFetches = {};  // { assistantId: true } 追踪哪些对话正在等AI回复
        let wechatUnreadCounts = {};   // { assistantId: number } 追踪未读消息数
        let editingWechatMessageId = null;  // 正在编辑的微信消息ID

        async function initWechatData() {
            // 优先从 IndexedDB 加载
            if (dbInstance) {
                const saved = await loadFromIndexedDB('wechatData');
                if (saved) {
                    wechatData = { ...wechatData, ...saved };
                    _wechatDataLoaded = true;
                    return;
                }
            }
            // 降级到 localStorage
            const saved = localStorage.getItem('miaomiao_wechat_v1');
            if (saved) {
                wechatData = { ...wechatData, ...JSON.parse(saved) };
            }
            _wechatDataLoaded = true;
        }

        function saveWechatData() {
            if (!_wechatDataLoaded) {
                console.warn('微信数据尚未加载完成，跳过保存以防覆盖');
                return false;
            }
            // 优先使用 IndexedDB
            if (dbInstance) {
                saveToIndexedDB('wechatData', wechatData).then(success => {
                    if (!success) {
                        console.warn('IndexedDB保存失败，尝试localStorage');
                        saveWechatToLocalStorage();
                    }
                });
                _cloudSyncDirty.wechatData = true;
                return true;
            }
            // 降级到 localStorage
            _cloudSyncDirty.wechatData = true;
            return saveWechatToLocalStorage();
        }

        function saveWechatToLocalStorage() {
            try {
                localStorage.setItem('miaomiao_wechat_v1', JSON.stringify(wechatData));
                return true;
            } catch (e) {
                console.error('微信模式localStorage保存失败:', e);
                if (e.name === 'QuotaExceededError' || e.message.includes('quota')) {
                    console.warn('⚠️ 微信模式存储空间已满，新消息可能无法持久保存。');
                }
                return false;
            }
        }

        async function openWechatMode() {
            await initWechatData();
            renderWechatList();
            openPage('wechatListPage');
            startProactiveTimer();
            mlabStartAutoTimer();
        }

        function closeWechatMode() {
            closePage('wechatListPage');
            stopProactiveTimer();
            mlabStopAutoTimer();
        }

        function renderWechatList() {
            const container = document.getElementById('wechatList');
            
            // 获取已导入的助手
            const importedAssistants = appData.assistants.filter(a => 
                wechatData.importedAssistants.includes(a.id)
            );
            
            if (importedAssistants.length === 0) {
                container.innerHTML = `
                    <div class="wechat-empty">
                        <div class="wechat-empty-icon">💬</div>
                        <div class="wechat-empty-text">还没有导入助手<br>点击右上角 + 导入</div>
                    </div>
                `;
                return;
            }

            container.innerHTML = importedAssistants.map(a => {
                const conv = wechatData.conversations[a.id];
                const lastMsg = conv && conv.messages && conv.messages.length > 0 
                    ? conv.messages[conv.messages.length - 1] 
                    : null;
                const isTyping = !!wechatPendingFetches[a.id];
                const preview = isTyping ? '正在输入...' : (lastMsg ? (lastMsg.content || '').substring(0, 20) : '暂无消息');
                const previewStyle = isTyping ? 'color: #07c160; font-style: italic;' : '';
                const time = lastMsg ? formatTimeShort(lastMsg.timestamp) : '';
                const unread = wechatUnreadCounts[a.id] || 0;
                const unreadBadge = unread > 0 ? `<div class="wechat-unread-badge">${unread > 99 ? '99+' : unread}</div>` : '';
                
                return `
                    <div class="wechat-list-item" onclick="openWechatChat('${a.id}')">
                        <div class="wechat-list-avatar">
                            ${a.avatar ? `<img src="${a.avatar}" alt="">` : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}
                            ${unreadBadge}
                        </div>
                        <div class="wechat-list-info">
                            <div class="wechat-list-name">${a.name}</div>
                            <div class="wechat-list-preview" style="${previewStyle}">${escapeHtml(preview)}</div>
                        </div>
                        <div class="wechat-list-meta">
                            <div class="wechat-list-time">${time}</div>
                            <button class="conversation-delete-btn" onclick="event.stopPropagation(); removeWechatAssistant('${a.id}')" style="display: flex; margin-top: 4px;">×</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function openWechatChat(assistantId) {
            wechatData.currentAssistantId = assistantId;
            // 清除未读数
            delete wechatUnreadCounts[assistantId];
            
            // 初始化对话数据
            if (!wechatData.conversations[assistantId]) {
                wechatData.conversations[assistantId] = {
                    messages: [],
                    settings: {
                        memoryCount: 20,
                        timeAware: false,
                        offlineMode: false
                    }
                };
            }
            
            const assistant = appData.assistants.find(a => a.id === assistantId);
            document.getElementById('wechatChatTitle').textContent = assistant ? assistant.name : '聊天';
            
            // 恢复pending状态：如果这个助手正在等AI回复，显示"正在输入中"并禁用发送按钮
            if (wechatPendingFetches[assistantId]) {
                const typingEl = document.getElementById('wechatTyping');
                if (typingEl) typingEl.classList.add('show');
                document.getElementById('wechatSendBtn').disabled = true;
            } else {
                const typingEl = document.getElementById('wechatTyping');
                if (typingEl) typingEl.classList.remove('show');
                document.getElementById('wechatSendBtn').disabled = false;
            }

            renderWechatMessages();
            openPage('wechatChatPage');
            setupWechatInput();
            initWechatLongPress();
            applyWechatTheme();
            applyBubbleOpacity();
            applyWechatPattern();
        }

        function backToWechatList() {
            closePage('wechatChatPage');
            renderWechatList();
        }

        let wechatInputInitialized = false; // 防止重复绑定事件监听器
        function setupWechatInput() {
            const textarea = document.getElementById('wechatInput');
            textarea.value = '';

            // 防止重复绑定事件监听器
            if (wechatInputInitialized) return;
            wechatInputInitialized = true;

            textarea.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 80) + 'px';
            });
            // 输入框按键处理：手机端回车换行，电脑端Enter发送/Ctrl+Enter换行
            textarea.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
                    if (isMobile) {
                        // 手机端：回车=换行（默认行为），发送靠按钮
                    } else {
                        // 电脑端：Enter=发送，Ctrl+Enter=换行
                        if (e.ctrlKey) {
                            // Ctrl+Enter：插入换行
                            const start = this.selectionStart;
                            const end = this.selectionEnd;
                            this.value = this.value.substring(0, start) + '\n' + this.value.substring(end);
                            this.selectionStart = this.selectionEnd = start + 1;
                            this.style.height = 'auto';
                            this.style.height = Math.min(this.scrollHeight, 80) + 'px';
                            e.preventDefault();
                        } else {
                            // Enter：发送消息
                            e.preventDefault();
                            wechatSendMessage();
                        }
                    }
                }
            });
        }

        // 缓存头像HTML避免重复生成
        let cachedUserAvatarHtml = null;
        let cachedAssistantAvatarHtml = {};

        function getCachedUserAvatarHtml() {
            const userAvatar = appData.settings.userAvatar;
            if (cachedUserAvatarHtml === null || cachedUserAvatarHtml.src !== userAvatar) {
                cachedUserAvatarHtml = {
                    src: userAvatar,
                    html: userAvatar
                        ? `<img src="${userAvatar}" alt="">`
                        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
                };
            }
            return cachedUserAvatarHtml.html;
        }

        function getCachedAssistantAvatarHtml(assistant) {
            if (!assistant) return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

            const cached = cachedAssistantAvatarHtml[assistant.id];
            if (cached && cached.src === assistant.avatar) {
                return cached.html;
            }

            const html = assistant.avatar
                ? `<img src="${assistant.avatar}" alt="">`
                : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

            cachedAssistantAvatarHtml[assistant.id] = { src: assistant.avatar, html };
            return html;
        }

        // 消息分页配置
        const WECHAT_PAGE_SIZE = 150; // 每页显示150条消息
        let wechatCurrentPage = 1; // 当前显示的页数（从最新往前数）

        function renderWechatMessages(loadMore = false) {
            const container = document.getElementById('wechatMessages');
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const messages = conv ? conv.messages : [];
            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);

            const myPendingMessages = wechatData.pendingMessages.filter(m => m._targetAssistantId === wechatData.currentAssistantId);
            if (messages.length === 0 && myPendingMessages.length === 0) {
                container.innerHTML = `
                    <div class="wechat-empty" style="height: 100%;">
                        <div class="wechat-empty-icon">💬</div>
                        <div class="wechat-empty-text">开始聊天吧</div>
                    </div>
                `;
                wechatCurrentPage = 1;
                return;
            }

            // 如果不是加载更多且不是跳转模式且不是保持位置模式，重置页数
            if (!loadMore && !wechatJumpToMsgId && wechatKeepScrollPosition === null) {
                wechatCurrentPage = 1;
            }

            // 计算要显示的消息范围
            const totalMessages = messages.length;
            const displayCount = wechatCurrentPage * WECHAT_PAGE_SIZE;
            const startIndex = Math.max(0, totalMessages - displayCount);
            const visibleMessages = messages.slice(startIndex);
            const hasMore = startIndex > 0;

            // 预先缓存头像HTML
            const userAvatarHtml = getCachedUserAvatarHtml();
            const assistantAvatarHtml = getCachedAssistantAvatarHtml(assistant);

            let html = '';

            // 如果还有更多历史消息，显示加载更多按钮
            if (hasMore) {
                html += `<div class="wechat-load-more" onclick="loadMoreWechatMessages()">
                    <span>↑ 加载更早的消息 (还有${startIndex}条)</span>
                </div>`;
            }

            // 渲染可见的消息
            let prevTimestamp = null;
            visibleMessages.forEach((msg, idx) => {
                // 时间分隔条：第一条消息或间隔超过10分钟
                if (msg.timestamp) {
                    const msgTime = new Date(msg.timestamp).getTime();
                    if (!prevTimestamp || msgTime - prevTimestamp > 10 * 60 * 1000) {
                        html += `<div class="wechat-time-divider"><span>${formatWechatDate(msg.timestamp)}</span></div>`;
                    }
                    prevTimestamp = msgTime;
                }

                // 每轮最后一条才显示时间戳：下一条不同role，或间隔>10分钟（会有分隔条），或是最后一条
                const nextMsg = visibleMessages[idx + 1];
                const hasTimeDividerAfter = nextMsg && nextMsg.timestamp && msg.timestamp &&
                    (new Date(nextMsg.timestamp).getTime() - new Date(msg.timestamp).getTime() > 10 * 60 * 1000);
                const showTimestamp = !nextMsg || nextMsg.role !== msg.role || hasTimeDividerAfter;

                html += renderWechatMessageFast(msg, assistant, userAvatarHtml, assistantAvatarHtml, false, showTimestamp);
            });

            // 渲染暂存的消息（只显示属于当前助手的）
            myPendingMessages.forEach(msg => {
                html += renderWechatMessageFast(msg, assistant, userAvatarHtml, assistantAvatarHtml, true);
            });

            // 如果是加载更多，保存当前滚动位置
            const oldScrollHeight = container.scrollHeight;

            container.innerHTML = html;

            if (wechatJumpToMsgId) {
                // 跳转模式：不自动滚动，由 jumpToWechatMessage 处理
            } else if (loadMore) {
                // 加载更多后，保持视觉位置不变
                requestAnimationFrame(() => {
                    const newScrollHeight = container.scrollHeight;
                    container.scrollTop = newScrollHeight - oldScrollHeight;
                });
            } else if (wechatKeepScrollPosition !== null) {
                // 编辑/删除/多选后，恢复之前的滚动位置
                requestAnimationFrame(() => {
                    container.scrollTop = wechatKeepScrollPosition;
                    wechatKeepScrollPosition = null;
                });
            } else {
                // 新渲染，滚动到底部
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                });
            }
        }

        let wechatKeepScrollPosition = null;

        // 加载更多历史消息
        function loadMoreWechatMessages() {
            wechatCurrentPage++;
            renderWechatMessages(true);
        }

        // 向后兼容的包装函数
        function renderWechatMessage(msg, assistant, isPending = false) {
            const userAvatarHtml = getCachedUserAvatarHtml();
            const assistantAvatarHtml = getCachedAssistantAvatarHtml(assistant);
            return renderWechatMessageFast(msg, assistant, userAvatarHtml, assistantAvatarHtml, isPending);
        }

        function renderWechatMessageFast(msg, assistant, userAvatarHtml, assistantAvatarHtml, isPending = false, showTimestamp = true) {
            const isUser = msg.role === 'user';
            const bubbleClass = isPending ? 'style="opacity: 0.7;"' : '';
            const isSelected = wechatMultiSelectMode && wechatSelectedMessages.has(msg.id);
            const selectedClass = isSelected ? ' selected' : '';

            // 多选复选框
            const selectCheckbox = '<div class="select-checkbox"></div>';

            // 时间戳HTML（只在每轮最后一条显示）
            const timeHtml = (ts) => showTimestamp ? `<div class="wechat-msg-time">${formatTimeShort(ts)}</div>` : '';

            // 拍一拍消息（支持长按删除）
            if (msg.type === 'pat_message' || msg.type === 'system') {
                return `<div class="wechat-system-msg" data-msg-id="${msg.id}"><span>${escapeHtml(msg.content)}</span></div>`;
            }

            // 转账消息
            if (msg.type === 'transfer') {
                const statusText = msg.status === 'accepted' ? '已收款' :
                                   msg.status === 'declined' ? '已退还' : '待确认';
                const isSentByUser = msg.role === 'user' || msg.senderName === '我';
                const displayTime = typeof msg.timestamp === 'number'
                    ? formatTimeShort(new Date(msg.timestamp).toISOString())
                    : formatTimeShort(msg.timestamp);
                // 用户收到的待确认转账可点击
                const isReceivable = !isSentByUser && msg.status === 'pending' && !isPending;
                const clickableClass = isReceivable ? ' clickable' : '';
                const statusClass = msg.status === 'accepted' ? ' accepted' : (msg.status === 'declined' ? ' declined' : '');
                const clickHandler = isReceivable ? `onclick="showTransferActionsModal('${msg.id}')"` : '';
                return `
                    <div class="wechat-msg ${isSentByUser ? 'user' : 'assistant'}${selectedClass}" ${bubbleClass} data-msg-id="${msg.id}">
                        ${selectCheckbox}
                        <div class="wechat-msg-avatar">
                            ${isSentByUser ? userAvatarHtml : assistantAvatarHtml}
                        </div>
                        <div class="wechat-msg-body">
                            <div class="wechat-transfer-card${clickableClass}${statusClass}" ${clickHandler}>
                                <div class="wechat-transfer-title">💰 转账给 ${msg.receiverName || '对方'}</div>
                                <div class="wechat-transfer-amount">¥${msg.amount?.toFixed(2) || '0.00'}</div>
                                ${msg.note ? `<div class="wechat-transfer-note">${escapeHtml(msg.note)}</div>` : ''}
                                <div class="wechat-transfer-status">${statusText}${isReceivable ? ' (点击处理)' : ''}</div>
                            </div>
                            ${showTimestamp ? `<div class="wechat-msg-time">${displayTime}</div>` : ''}
                        </div>
                    </div>
                `;
            }

            // 转账收款/拒收通知消息
            if (msg.type === 'transfer_receipt') {
                const isAccepted = msg.action === 'accepted';
                const isFromUser = msg.role === 'user';
                const actionText = isAccepted ? '已收款' : '已退还';
                const icon = isAccepted ? '💚' : '💔';
                const statusClass = isAccepted ? 'accepted' : 'declined';
                const displayTime = typeof msg.timestamp === 'number'
                    ? formatTimeShort(new Date(msg.timestamp).toISOString())
                    : formatTimeShort(msg.timestamp);

                return `
                    <div class="wechat-msg ${isFromUser ? 'user' : 'assistant'}${selectedClass}" ${bubbleClass} data-msg-id="${msg.id}">
                        ${selectCheckbox}
                        <div class="wechat-msg-avatar">
                            ${isFromUser ? userAvatarHtml : assistantAvatarHtml}
                        </div>
                        <div class="wechat-msg-body">
                            <div class="wechat-transfer-card ${statusClass}">
                                <div class="wechat-transfer-title">${icon} ${actionText}</div>
                                <div class="wechat-transfer-amount">¥${msg.amount?.toFixed(2) || '0.00'}</div>
                                <div class="wechat-transfer-status">${isAccepted ? '已存入余额' : '已退回对方'}</div>
                            </div>
                            ${showTimestamp ? `<div class="wechat-msg-time">${displayTime}</div>` : ''}
                        </div>
                    </div>
                `;
            }

            if (msg.type === 'voice_message') {
                const cleanContent = stripInterjectionsAlways(msg.content || '');
                const duration = Math.max(1, Math.ceil(cleanContent.length / 4));
                // 根据秒数决定长度样式
                let voiceLengthClass = 'voice-short';
                if (duration > 10) voiceLengthClass = 'voice-long';
                else if (duration > 5) voiceLengthClass = 'voice-medium';

                // 用户语音消息：简化显示，无播放功能
                if (isUser) {
                    return `
                        <div class="wechat-msg user${selectedClass}" ${bubbleClass} data-msg-id="${msg.id}">
                            ${selectCheckbox}
                            <div class="wechat-msg-avatar">
                                ${userAvatarHtml}
                            </div>
                            <div class="wechat-msg-body" style="max-width: none;">
                                <div style="display: flex; align-items: center; flex-direction: row-reverse;">
                                    <div class="wechat-msg-bubble wechat-voice-bubble ${voiceLengthClass}">
                                        <svg class="wechat-voice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
                                        <span class="wechat-voice-duration">${duration}"</span>
                                    </div>
                                </div>
                                <div class="wechat-voice-text" style="display: block;">${escapeHtml(stripInterjectionsAlways(msg.content || ''))}</div>
                                ${timeHtml(msg.timestamp)}
                            </div>
                        </div>
                    `;
                }

                // 助手语音消息：有播放和转文字功能
                return `
                    <div class="wechat-msg assistant${selectedClass}" ${bubbleClass} data-msg-id="${msg.id}">
                        ${selectCheckbox}
                        <div class="wechat-msg-avatar">
                            ${assistantAvatarHtml}
                        </div>
                        <div class="wechat-msg-body" style="max-width: none;">
                            <div style="display: flex; align-items: center;">
                                <div class="wechat-msg-bubble wechat-voice-bubble ${voiceLengthClass}" id="voice-bubble-${msg.id}" onclick="playVoiceMessage('${msg.id}')">
                                    <div class="wechat-voice-loading" id="voice-loading-${msg.id}"></div>
                                    <svg class="wechat-voice-icon" id="voice-icon-${msg.id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
                                    <span class="wechat-voice-duration">${duration}"</span>
                                </div>
                                <span class="wechat-voice-convert" onclick="event.stopPropagation(); convertVoiceToText('${msg.id}')">转文字</span>
                            </div>
                            <div class="wechat-voice-text" id="voice-text-${msg.id}">${escapeHtml(stripInterjectionsAlways(msg.content || ''))}</div>
                            ${timeHtml(msg.timestamp)}
                        </div>
                    </div>
                `;
            }

            // 图片消息
            if (msg.type === 'image') {
                // 检查图片数据是否存在
                const hasImage = msg.content && msg.content.startsWith('data:');
                const hasThumbnail = msg.thumbnail && msg.thumbnail.startsWith('data:');
                const imageContent = hasImage
                    ? `<img src="${msg.content}" alt="${msg.fileName || '图片'}">`
                    : hasThumbnail
                        ? `<img src="${msg.thumbnail}" alt="缩略图" style="opacity: 0.5; filter: blur(1px);">`
                        : `<div style="width: 100px; height: 100px; background: #eee; display: flex; align-items: center; justify-content: center; color: #999; font-size: 12px;">[图片已清除]</div>`;
                const clickHandler = hasImage ? `onclick="showWechatImagePreview('${msg.id}')"` : '';
                return `
                    <div class="wechat-msg ${isUser ? 'user' : 'assistant'}${selectedClass}" ${bubbleClass} data-msg-id="${msg.id}">
                        ${selectCheckbox}
                        <div class="wechat-msg-avatar">
                            ${isUser ? userAvatarHtml : assistantAvatarHtml}
                        </div>
                        <div class="wechat-msg-body">
                            <div class="wechat-msg-image" ${clickHandler}>
                                ${imageContent}
                            </div>
                            ${timeHtml(msg.timestamp)}
                        </div>
                    </div>
                `;
            }

            // 文件消息：显示为卡片样式
            if (msg.isFile && msg.fileName) {
                const ext = msg.fileName.split('.').pop().toLowerCase();
                const iconMap = { md: '📝', txt: '📄', json: '📋', js: '📜', html: '🌐', css: '🎨', py: '🐍', csv: '📊' };
                const fileIcon = iconMap[ext] || '📄';
                return `
                    <div class="wechat-msg ${isUser ? 'user' : 'assistant'}${selectedClass}" ${bubbleClass} data-msg-id="${msg.id}">
                        ${selectCheckbox}
                        <div class="wechat-msg-avatar">
                            ${isUser ? userAvatarHtml : assistantAvatarHtml}
                        </div>
                        <div class="wechat-msg-body">
                            <div class="wechat-file-card">
                                <span class="wechat-file-card-icon">${fileIcon}</span>
                                <span class="wechat-file-card-name">${escapeHtml(msg.fileName)}</span>
                            </div>
                            ${timeHtml(msg.timestamp)}
                        </div>
                    </div>
                `;
            }

            // 引用消息HTML
            const quoteHtml = msg.quote ? `
                <div class="wechat-msg-quote">
                    <div class="wechat-msg-quote-name">${escapeHtml(msg.quote.senderName)}：</div>
                    <div class="wechat-msg-quote-content">${escapeHtml(stripInterjectionsAlways(msg.quote.content))}</div>
                </div>
            ` : '';

            return `
                <div class="wechat-msg ${isUser ? 'user' : 'assistant'}${selectedClass}" ${bubbleClass} data-msg-id="${msg.id}">
                    ${selectCheckbox}
                    <div class="wechat-msg-avatar">
                        ${isUser ? userAvatarHtml : assistantAvatarHtml}
                    </div>
                    <div class="wechat-msg-body">
                        <div class="wechat-msg-bubble">
                            ${quoteHtml}
                            ${formatMessageContent(msg.content, false)}
                        </div>
                        ${timeHtml(msg.timestamp)}
                    </div>
                </div>
            `;
        }
