/**
 * API模式聊天功能
 *
 * 负责：侧边栏、对话列表、消息渲染(带缓存)、编辑/删除/版本切换/重新生成、
 *        工具栏/模型选择器、数据导入导出、showAttachmentPreview
 * 暴露函数：toggleChatSidebar, renderSidebarAssistants, selectAssistant,
 *           updateChatHeader, renderConversationList, renderMessages, scheduleStreamRender,
 *           showModelSelector, quickSelectModel, exportData, importData,
 *           createNewConversation, showComingSoon
 * 依赖：appData(data.js), saveData(storage.js), openPage/closePage(navigation.js),
 *        escapeHtml(ui.js), formatDate/formatTime(time.js), formatMessageContent(markdown.js),
 *        showModal/hideModal(ui.js), openAssistantMemoryPanel(assistants.js),
 *        isSending/streamChat/buildRequestBody/processStreamResponse(api-send.js),
 *        pendingFiles/clearPendingFiles/buildMultimodalContent(file-upload.js)
 */

        // ==================== 聊天功能 ====================
        function toggleChatSidebar() {
            const sidebar = document.getElementById('chatSidebar');
            const backdrop = document.getElementById('sidebarBackdrop');
            sidebar.classList.toggle('open');
            backdrop.classList.toggle('show');
        }

        function toggleAssistantList() {
            const list = document.getElementById('sidebarAssistantList');
            const arrow = document.getElementById('assistantListArrow');
            list.classList.toggle('expanded');
            arrow.classList.toggle('up');
        }

        function renderSidebarAssistants() {
            const container = document.getElementById('sidebarAssistantList');
            container.innerHTML = appData.assistants.map(a => `
                <div class="sidebar-assistant-item ${a.id === appData.currentAssistantId ? 'active' : ''}" onclick="selectAssistant('${a.id}')">
                    <div class="sidebar-assistant-item-avatar">
                        ${a.avatar ? `<img src="${a.avatar}" alt="">` : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}
                    </div>
                    <span style="font-size: 13px; flex: 1;">${a.name}</span>
                    <button class="sidebar-assistant-gear" onclick="event.stopPropagation(); openAssistantMemoryPanel('${a.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    </button>
                </div>
            `).join('');

            updateSidebarAssistantInfo();
        }

        function updateSidebarAssistantInfo() {
            const assistant = appData.assistants.find(a => a.id === appData.currentAssistantId);
            const nameEl = document.getElementById('sidebarAssistantName');
            const modelEl = document.getElementById('sidebarAssistantModel');
            const avatarEl = document.getElementById('sidebarAssistantAvatar');

            if (assistant) {
                nameEl.textContent = assistant.name;
                // 显示全局默认模型
                const globalModel = appData.settings.defaultModel;
                if (globalModel) {
                    const [providerId, modelId] = globalModel.split('||');
                    const provider = appData.providers.find(p => p.id === providerId);
                    const model = provider?.models?.find(m => m.id === modelId);
                    modelEl.textContent = (model?.name || modelId) + (provider ? ` · ${provider.name}` : '');
                } else {
                    modelEl.textContent = '请设置默认模型';
                }
                if (assistant.avatar) {
                    avatarEl.innerHTML = `<img src="${assistant.avatar}" alt="">`;
                }
            } else {
                nameEl.textContent = '未选择助手';
                modelEl.textContent = '请先创建助手';
            }
        }

        function selectAssistant(id) {
            appData.currentAssistantId = id;
            // 切换到该助手的最近对话，没有则清空
            const assistantConvs = appData.conversations.filter(c => c.assistantId === id);
            if (assistantConvs.length > 0) {
                // 按更新时间排序，选最近的
                assistantConvs.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
                appData.currentConversationId = assistantConvs[0].id;
            } else {
                appData.currentConversationId = null;
            }
            saveData();
            renderSidebarAssistants();
            renderConversationList();
            renderMessages();
            updateChatHeader();
            toggleAssistantList();
        }

        function updateChatHeader() {
            const conv = appData.conversations.find(c => c.id === appData.currentConversationId);
            document.getElementById('chatTitle').textContent = conv ? conv.title : '新对话';

            // 更新模型选择显示：对话临时模型 > 助手默认模型 > 全局默认模型
            const assistant = appData.assistants.find(a => a.id === appData.currentAssistantId);
            const assistantModel = assistant?.providerId && assistant?.modelId ? `${assistant.providerId}||${assistant.modelId}` : '';
            const globalModel = appData.settings.defaultModel;
            const currentModel = appData.settings.apiTempModel || assistantModel || globalModel || '';

            if (currentModel) {
                const [providerId, modelId] = currentModel.split('||');
                const provider = appData.providers.find(p => p.id === providerId);
                const model = provider?.models?.find(m => m.id === modelId);
                const displayName = model?.name || modelId || '未知模型';
                document.getElementById('currentModelDisplay').textContent = displayName.length > 20 ? displayName.substring(0, 20) + '...' : displayName;
            } else {
                document.getElementById('currentModelDisplay').textContent = '选择模型';
            }
        }

        function renderConversationList() {
            const container = document.getElementById('sidebarConversations');
            const assistantConvs = appData.conversations.filter(c => c.assistantId === appData.currentAssistantId);

            if (assistantConvs.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="padding: 30px 20px;">
                        <div class="empty-state-text">暂无对话<br>点击右上角开始新对话</div>
                    </div>
                `;
                return;
            }

            container.innerHTML = assistantConvs.map(c => `
                <div class="conversation-item ${c.id === appData.currentConversationId ? 'active' : ''}" onclick="selectConversation('${c.id}')">
                    <div class="conversation-item-content">
                        <div class="conversation-item-title">${c.title}</div>
                        <div class="conversation-item-preview">${formatDate(c.updatedAt)}</div>
                    </div>
                    <button class="conversation-delete-btn" onclick="event.stopPropagation(); deleteConversation('${c.id}')">×</button>
                </div>
            `).join('');

            // 给每个对话项绑定长按事件
            container.querySelectorAll('.conversation-item').forEach((el, i) => {
                const convId = assistantConvs[i].id;
                let pressTimer = null;
                const startPress = (e) => {
                    pressTimer = setTimeout(() => {
                        e.preventDefault();
                        showConversationMenu(convId, e);
                    }, 500);
                };
                const cancelPress = () => { clearTimeout(pressTimer); };
                el.addEventListener('touchstart', startPress, { passive: true });
                el.addEventListener('touchend', cancelPress);
                el.addEventListener('touchmove', cancelPress);
                el.addEventListener('contextmenu', (e) => { e.preventDefault(); showConversationMenu(convId, e); });
            });
        }

        function selectConversation(id) {
            appData.currentConversationId = id;
            saveData();
            renderConversationList();
            renderMessages();
            updateChatHeader();
            toggleChatSidebar();
        }

        function deleteConversation(id) {
            if (!confirm('确定要删除这个对话吗？')) return;
            appData.conversations = appData.conversations.filter(c => c.id !== id);
            delete appData.messages[id];
            if (appData.currentConversationId === id) {
                appData.currentConversationId = null;
            }
            saveData();
            renderConversationList();
            renderMessages();
            updateChatHeader();
        }

        function showConversationMenu(convId, e) {
            // 移除已有菜单
            document.querySelectorAll('.conv-context-menu').forEach(m => m.remove());

            const menu = document.createElement('div');
            menu.className = 'conv-context-menu';
            menu.innerHTML = `
                <div class="conv-context-menu-item" onclick="renameConversation('${convId}'); this.parentElement.remove();">✏️ 重命名</div>
                <div class="conv-context-menu-item conv-context-menu-danger" onclick="deleteConversation('${convId}'); this.parentElement.remove();">🗑️ 删除</div>
            `;

            document.body.appendChild(menu);

            // 定位菜单
            const rect = e.target.closest('.conversation-item').getBoundingClientRect();
            menu.style.top = Math.min(rect.bottom, window.innerHeight - menu.offsetHeight - 10) + 'px';
            menu.style.left = Math.min(rect.left + 20, window.innerWidth - menu.offsetWidth - 10) + 'px';

            // 点击其他地方关闭菜单
            setTimeout(() => {
                document.addEventListener('click', function closeMenu() {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                });
            }, 10);
        }

        function renameConversation(id) {
            const conv = appData.conversations.find(c => c.id === id);
            if (!conv) return;
            const newTitle = prompt('重命名对话', conv.title);
            if (newTitle === null || newTitle.trim() === '') return;
            conv.title = newTitle.trim();
            saveData();
            renderConversationList();
            updateChatHeader();
        }

        function createNewConversation() {
            if (!appData.currentAssistantId) {
                alert('请先选择一个助手');
                return;
            }

            const conv = {
                id: 'conv_' + Date.now(),
                title: '新对话',
                assistantId: appData.currentAssistantId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            appData.conversations.unshift(conv);
            appData.messages[conv.id] = [];
            appData.currentConversationId = conv.id;
            saveData();

            renderConversationList();
            renderMessages();
            updateChatHeader();
        }

        // 消息渲染HTML缓存：已完成的消息不需要每次重新渲染
        const _msgRenderCache = new Map(); // key: msgId, value: { content, reasoningText, currentVersion, html }

        function renderMessages() {
            const container = document.getElementById('chatMessages');
            const messages = appData.messages[appData.currentConversationId] || [];

            if (messages.length === 0) {
                _msgRenderCache.clear();
                container.innerHTML = `
                    <div class="welcome-view">
                        <div class="welcome-icon">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent-dark)" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </div>
                        <div class="welcome-title">开始新对话</div>
                        <div class="welcome-desc">在下方输入消息开始聊天</div>
                    </div>
                `;
                return;
            }

            const htmlParts = messages.map(m => {
                // 流式输出中的消息不缓存
                if (m.isStreaming) {
                    _msgRenderCache.delete(m.id);
                    return renderMessage(m);
                }
                // 检查缓存是否命中
                const cached = _msgRenderCache.get(m.id);
                const currentVersion = m.currentVersion || 0;
                if (cached && cached.content === m.content && cached.reasoningText === (m.reasoningText || '') && cached.currentVersion === currentVersion) {
                    return cached.html;
                }
                // 缓存未命中，重新渲染并缓存
                const html = renderMessage(m);
                _msgRenderCache.set(m.id, { content: m.content, reasoningText: m.reasoningText || '', currentVersion, html });
                return html;
            });

            container.innerHTML = htmlParts.join('');
            if (!renderMessages._keepScroll) {
                container.scrollTop = container.scrollHeight;
            }
            renderMessages._keepScroll = false;
        }

        // 节流版renderMessages：流式输出时使用，每帧最多渲染一次
        let _streamRenderScheduled = false;
        function scheduleStreamRender() {
            if (_streamRenderScheduled) return;
            _streamRenderScheduled = true;
            requestAnimationFrame(() => {
                _streamRenderScheduled = false;
                renderMessages();
            });
        }

        function renderMessage(msg) {
            const isUser = msg.role === 'user';
            const assistant = appData.assistants.find(a => a.id === appData.currentAssistantId);

            // 获取当前版本和总版本数
            const versions = msg.versions || [msg.content];
            const currentVersion = msg.currentVersion || 0;
            const hasMultipleVersions = versions.length > 1;

            let thinkingHtml = '';
            if (!isUser && msg.reasoningText) {
                const isExpanded = msg.isStreaming && !msg.content;
                thinkingHtml = `
                    <div class="thinking-block">
                        <div class="thinking-header" onclick="toggleThinking(this)">
                            <div class="thinking-header-left">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                                <span>深度思考 ${msg.thinkingDuration ? '(' + msg.thinkingDuration + ')' : ''}</span>
                            </div>
                            <span class="icon-arrow ${isExpanded ? '' : 'up'}"></span>
                        </div>
                        <div class="thinking-content ${isExpanded ? 'expanded' : ''}">${escapeHtml(msg.reasoningText)}</div>
                    </div>
                `;
            }

            const currentContent = versions[currentVersion] || msg.content;

            // 当正在流式输出时，不显示版本切换
            const showVersionControl = hasMultipleVersions && !msg.isStreaming;

            if (isUser) {
                const userVersionHtml = showVersionControl ? `
                    <div class="message-version">
                        <button class="message-version-btn" onclick="switchMessageVersion('${msg.id}', -1)">‹</button>
                        <span>${currentVersion + 1}/${versions.length}</span>
                        <button class="message-version-btn" onclick="switchMessageVersion('${msg.id}', 1)">›</button>
                    </div>
                ` : '';

                // 渲染附件
                let attachmentsHtml = '';
                if (msg.attachments && msg.attachments.length > 0) {
                    attachmentsHtml = `<div class="message-attachments">` +
                        msg.attachments.map((att, idx) => {
                            if (att.isImage && att.preview) {
                                // 使用data属性存储消息ID和附件索引，避免在onclick中放base64
                                return `<div class="message-attachment-item"><img src="${att.preview}" alt="${att.name}" data-msg-id="${msg.id}" data-att-idx="${idx}" onclick="showAttachmentPreview(this)"></div>`;
                            } else {
                                return `<div class="message-attachment-item message-attachment-doc"><span class="file-icon">📄</span><span>${att.name}</span></div>`;
                            }
                        }).join('') +
                    `</div>`;
                }

                // 获取用户头像和名称
                const userAvatar = appData.settings.userAvatar;
                const userName = appData.settings.userName || '';
                const userAvatarHtml = userAvatar
                    ? `<img src="${userAvatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
                    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

                return `
                    <div class="message user">
                        <div class="message-header">
                            <div class="message-info">
                                ${userName ? `<span class="message-name">${escapeHtml(userName)}</span>` : ''}
                                <span class="message-time">${formatTime(msg.timestamp)}</span>
                            </div>
                            <div class="message-avatar">
                                ${userAvatarHtml}
                            </div>
                        </div>
                        <div class="message-body">
                            ${attachmentsHtml}
                            <div class="message-bubble">${formatMessageContent(currentContent, false)}</div>
                            <div class="message-actions">
                                <button class="message-action-btn" onclick="copyMessage('${msg.id}')" title="复制">
                                    <span class="icon-copy"></span>
                                </button>
                                <button class="message-action-btn" onclick="editMessage('${msg.id}')" title="编辑">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                <button class="message-action-btn" onclick="regenerateFromMessage('${msg.id}')" title="重新发送">
                                    <span class="icon-refresh"></span>
                                </button>
                                <button class="message-action-btn" onclick="deleteMessage('${msg.id}')" title="删除">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                                ${userVersionHtml}
                            </div>
                        </div>
                    </div>
                `;
            } else {
                // 助手消息：isStreaming时显示加载或流式内容，否则显示当前版本
                const displayContent = msg.isStreaming ? msg.content : currentContent;
                const showTypingIndicator = msg.isStreaming && !msg.content && !msg.reasoningText;

                const assistantVersionHtml = showVersionControl ? `
                    <div class="message-version">
                        <button class="message-version-btn" onclick="switchMessageVersion('${msg.id}', -1)">‹</button>
                        <span>${currentVersion + 1}/${versions.length}</span>
                        <button class="message-version-btn" onclick="switchMessageVersion('${msg.id}', 1)">›</button>
                    </div>
                ` : '';

                return `
                    <div class="message assistant">
                        <div class="message-header">
                            <div class="message-avatar">
                                ${assistant?.avatar ? `<img src="${assistant.avatar}" alt="">` : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}
                            </div>
                            <div class="message-info">
                                <span class="message-name">${assistant?.name || 'AI'}</span>
                                <div class="message-meta"><span class="message-time">${formatTime(msg.timestamp)}</span>${msg.totalTokens && !msg.isStreaming ? `<span class="message-tokens">${msg.totalTokens} tokens</span>` : ''}</div>
                            </div>
                        </div>
                        <div class="message-body">
                            ${thinkingHtml}
                            <div class="message-content">${showTypingIndicator ? '<div class="typing-indicator"><span></span><span></span><span></span></div>' : formatMessageContent(displayContent)}</div>
                            <div class="message-actions">
                                <button class="message-action-btn" onclick="copyMessage('${msg.id}')" title="复制">
                                    <span class="icon-copy"></span>
                                </button>
                                <button class="message-action-btn" onclick="regenerateResponse('${msg.id}')" title="重新生成" ${msg.isStreaming ? 'disabled' : ''}>
                                    <span class="icon-refresh"></span>
                                </button>
                                <button class="message-action-btn" onclick="deleteMessage('${msg.id}')" title="删除" ${msg.isStreaming ? 'disabled' : ''}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                                ${assistantVersionHtml}
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        function toggleThinking(el) {
            const content = el.nextElementSibling;
            const arrow = el.querySelector('.icon-arrow');
            content.classList.toggle('expanded');
            arrow.classList.toggle('up');
        }

        function copyMessage(msgId) {
            const messages = appData.messages[appData.currentConversationId] || [];
            const msg = messages.find(m => m.id === msgId);
            if (msg) {
                const versions = msg.versions || [msg.content];
                const currentVersion = msg.currentVersion || 0;
                navigator.clipboard.writeText(versions[currentVersion] || msg.content).then(() => {
                    alert('已复制到剪贴板');
                });
            }
        }

        function editMessage(msgId) {
            const messages = appData.messages[appData.currentConversationId] || [];
            const msg = messages.find(m => m.id === msgId);
            if (msg) {
                editingMessageId = msgId;
                const versions = msg.versions || [msg.content];
                const currentVersion = msg.currentVersion || 0;
                document.getElementById('editMessageContent').value = versions[currentVersion] || msg.content;
                showModal('editMessageModal');
            }
        }

        function saveEditedMessage() {
            const newContent = document.getElementById('editMessageContent').value.trim();
            if (!newContent) {
                alert('消息内容不能为空');
                return;
            }

            const messages = appData.messages[appData.currentConversationId] || [];
            const msg = messages.find(m => m.id === editingMessageId);
            if (msg) {
                // 初始化版本数组
                if (!msg.versions) {
                    msg.versions = [msg.content];
                    msg.currentVersion = 0;
                }

                // 添加新版本
                msg.versions.push(newContent);
                msg.currentVersion = msg.versions.length - 1;
                msg.content = newContent;

                saveData();
                renderMessages();
            }

            hideModal('editMessageModal');
            editingMessageId = null;
        }

        function switchMessageVersion(msgId, direction) {
            const messages = appData.messages[appData.currentConversationId] || [];
            const msg = messages.find(m => m.id === msgId);
            if (msg && msg.versions) {
                let newVersion = (msg.currentVersion || 0) + direction;
                if (newVersion < 0) newVersion = msg.versions.length - 1;
                if (newVersion >= msg.versions.length) newVersion = 0;
                msg.currentVersion = newVersion;
                msg.content = msg.versions[newVersion];
                saveData();
                const container = document.getElementById('chatMessages');
                const scrollPos = container ? container.scrollTop : 0;
                renderMessages._keepScroll = true;
                renderMessages();
                if (container) container.scrollTop = scrollPos;
            }
        }

        async function regenerateResponse(msgId) {
            if (isSending) return; // 防止和发送消息冲突

            const messages = appData.messages[appData.currentConversationId] || [];
            const msgIndex = messages.findIndex(m => m.id === msgId);
            if (msgIndex === -1) return;

            const assistant = appData.assistants.find(a => a.id === appData.currentAssistantId);

            // 复用 sendMessage 的模型解析逻辑：tempModel > assistantModel > globalModel
            const conv = appData.conversations.find(c => c.id === appData.currentConversationId);
            const tempModel = appData.settings.apiTempModel;
            const assistantModel = assistant?.providerId && assistant?.modelId ? `${assistant.providerId}||${assistant.modelId}` : '';
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

            const effectiveAssistant = { ...assistant, providerId, modelId };

            const aiMsg = messages[msgIndex];

            // 保存旧版本
            if (!aiMsg.versions) {
                aiMsg.versions = [aiMsg.content];
                aiMsg.currentVersion = 0;
            }

            // 标记为正在流式输出，清空当前内容
            aiMsg.isStreaming = true;
            aiMsg.content = '';
            aiMsg.reasoningText = '';
            aiMsg.thinkingDuration = '';

            isSending = true;
            const chatSendBtn = document.getElementById('chatSendBtn');
            chatSendBtn.disabled = true;
            renderMessages();

            try {
                // 构建历史消息（不包括当前AI消息）
                const historyMessages = messages.slice(0, msgIndex);

                // 构建请求消息
                const requestMessages = [];
                let systemContent = assistant.systemPrompt || '';
                const now2 = new Date();
                const timeStr2 = now2.getFullYear() + '-' + String(now2.getMonth()+1).padStart(2,'0') + '-' + String(now2.getDate()).padStart(2,'0') + ' ' + String(now2.getHours()).padStart(2,'0') + ':' + String(now2.getMinutes()).padStart(2,'0');
                const weekDays2 = ['日','一','二','三','四','五','六'];
                systemContent += `\n\n【当前时间】${timeStr2} 星期${weekDays2[now2.getDay()]}`;
                if (assistant.memoryEnabled && assistant.memories && assistant.memories.length > 0) {
                    systemContent += '\n\n【记忆】\n' + assistant.memories.join('\n');
                }
                if (systemContent) {
                    requestMessages.push({ role: 'system', content: systemContent });
                }
                const contextLength = appData.settings.apiContextLength || 20;
                for (const m of historyMessages.slice(-contextLength)) {
                    requestMessages.push({ role: m.role, content: m.content });
                }

                const requestBody = buildRequestBody(effectiveAssistant, requestMessages);

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
                } else {
                    // 流式处理
                    await processStreamResponse(response, aiMsg);
                }

                // 添加新版本
                aiMsg.versions.push(aiMsg.content);
                aiMsg.currentVersion = aiMsg.versions.length - 1;

            } catch (error) {
                console.error('请求失败:', error);
                const errorContent = '请求失败：' + error.message;
                aiMsg.content = errorContent;
                aiMsg.versions.push(errorContent);
                aiMsg.currentVersion = aiMsg.versions.length - 1;
            } finally {
                aiMsg.isStreaming = false;
                isSending = false;
                chatSendBtn.disabled = false;
                saveData();
                renderMessages();
            }
        }

        async function regenerateFromMessage(userMsgId) {
            if (isSending) return;
            const messages = appData.messages[appData.currentConversationId] || [];
            const userMsgIndex = messages.findIndex(m => m.id === userMsgId);
            if (userMsgIndex === -1) return;

            const userMsg = messages[userMsgIndex];
            const aiMsgIndex = userMsgIndex + 1;

            // 如果下一条是AI消息，就删掉它重新生成；否则直接新建AI消息
            if (aiMsgIndex < messages.length && messages[aiMsgIndex].role === 'assistant') {
                // 删除旧的AI回复
                messages.splice(aiMsgIndex, 1);
            }

            // 获取模型配置（复用sendMessage的逻辑）
            const assistant = appData.assistants.find(a => a.id === appData.currentAssistantId);
            if (!assistant) { alert('请先选择一个助手'); return; }
            const tempModel = appData.settings.apiTempModel;
            const assistantModel = assistant.providerId && assistant.modelId ? `${assistant.providerId}||${assistant.modelId}` : '';
            const globalModel = appData.settings.defaultModel;
            const modelValue = tempModel || assistantModel || globalModel;
            if (!modelValue) { alert('请先在设置中选择默认模型'); return; }
            const [providerId, modelId] = modelValue.split('||');
            const provider = appData.providers.find(p => p.id === providerId);
            if (!provider) { alert('找不到对应的供应商配置'); return; }

            const effectiveAssistant = { ...assistant, providerId, modelId };

            // 新建AI消息
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
            // 插到用户消息后面
            messages.splice(userMsgIndex + 1, 0, aiMsg);

            isSending = true;
            const chatSendBtn = document.getElementById('chatSendBtn');
            chatSendBtn.disabled = true;
            renderMessages();

            try {
                await streamChat(provider, effectiveAssistant, aiMsg);
                aiMsg.versions[0] = aiMsg.content;
                aiMsg.isStreaming = false;
                const conv = appData.conversations.find(c => c.id === appData.currentConversationId);
                if (conv) conv.updatedAt = new Date().toISOString();
            } catch (error) {
                console.error('重新生成失败:', error);
                if (aiMsg.content && aiMsg.content.trim().length > 0) {
                    aiMsg.versions[0] = aiMsg.content;
                } else {
                    aiMsg.content = '请求失败：' + error.message;
                    aiMsg.versions[0] = aiMsg.content;
                }
                aiMsg.isStreaming = false;
            } finally {
                isSending = false;
                chatSendBtn.disabled = false;
                saveData();
                renderMessages();
            }
        }

        function deleteMessage(msgId) {
            if (!confirm('确定要删除这条消息吗？')) return;
            const messages = appData.messages[appData.currentConversationId] || [];
            const msgIndex = messages.findIndex(m => m.id === msgId);
            if (msgIndex === -1) return;
            messages.splice(msgIndex, 1);
            _msgRenderCache.delete(msgId);
            saveData();
            renderMessages();
        }

        // ==================== 工具栏功能 ====================
        function showModelSelector() {
            const allModels = [];
            appData.providers.forEach(p => {
                (p.models || []).forEach(m => {
                    allModels.push({ ...m, providerId: p.id, providerName: p.name });
                });
            });

            if (allModels.length === 0) {
                alert('请先在设置中添加供应商和模型');
                return;
            }

            // 获取当前使用的模型：对话临时模型 > 助手默认模型 > 全局默认模型
            const conv = appData.conversations.find(c => c.id === appData.currentConversationId);
            const assistant = appData.assistants.find(a => a.id === appData.currentAssistantId);
            const assistantModel = assistant?.providerId && assistant?.modelId ? `${assistant.providerId}||${assistant.modelId}` : '';
            const globalModel = appData.settings.defaultModel;
            const currentModel = appData.settings.apiTempModel || assistantModel || globalModel || '';
            const [, currentModelId] = currentModel ? currentModel.split('||') : ['', ''];

            // 只显示模型名，换行显示长名称
            document.getElementById('modelSelectContent').innerHTML = allModels.map(m => `
                <div class="model-item ${m.id === currentModelId ? 'selected' : ''}" onclick="quickSelectModel('${m.providerId}', '${m.id}')" style="padding: 12px;">
                    <div class="model-item-checkbox"></div>
                    <div class="model-item-info">
                        <div class="model-item-name">${m.name || m.id}</div>
                    </div>
                </div>
            `).join('');

            showModal('modelSelectModal');
        }

        // API模式全局临时模型切换（优先于助手默认模型，但不修改助手设置）
        function quickSelectModel(providerId, modelId) {
            appData.settings.apiTempModel = `${providerId}||${modelId}`;
            saveData();
            updateChatHeader();
            hideModal('modelSelectModal');
        }

        // ==================== 数据导入导出 ====================
        function exportData() {
            const dataStr = JSON.stringify(appData, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'miaomiao_chat_backup_' + new Date().toISOString().split('T')[0] + '.json';
            a.click();
            URL.revokeObjectURL(url);
        }

        function importData() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (confirm('确定要导入数据吗？这将覆盖现有数据。')) {
                        appData = { ...appData, ...data };
                        saveData();
                        location.reload();
                    }
                } catch (err) {
                    alert('导入失败: ' + err.message);
                }
            };
            input.click();
        }

        function showComingSoon() {
            alert('功能开发中，敬请期待~');
        }

