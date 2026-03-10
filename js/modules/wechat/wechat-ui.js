/**
 * 微信模式 - UI交互
 *
 * 负责：加号面板、拍一拍、转账、搜索、手动语音输入(假语音)、
 *        助手导入/移除、消息编辑/删除、长按菜单、多选、文本替换、
 *        待发消息编辑/删除、引用消息、多选导出
 * 暴露函数：toggleWechatPlusPanel, closeWechatPlusPanel, openPokeModal,
 *           showImportAssistantModal, removeWechatAssistant,
 *           initWechatLongPress, closeWechatContextMenu,
 *           wechatQuotedMessage, clearWechatQuote, showExportFormatModal,
 *           editingWechatIsPending, editWechatMessage
 * 依赖：appData(data.js), wechatData/saveWechatData/renderWechatMessages/
 *        renderWechatList/editingWechatMessageId(wechat-core.js),
 *        showModal/hideModal/escapeHtml/downloadFile(ui.js),
 *        openPage/closePage(navigation.js), formatMessageContent(markdown.js),
 *        startVoiceInputCommon/stopVoiceInputCommon(stt.js),
 *        playTtsAudio/isTtsConfigured(tts.js),
 *        pendingFiles/clearPendingFiles/selectImage/capturePhoto/selectFile/currentUploadMode(file-upload.js)
 */

        // ========== 加号展开面板功能 ==========
        function toggleWechatPlusPanel() {
            const panel = document.getElementById('wechatPlusPanel');
            const btn = document.querySelector('.wechat-plus-btn');
            panel.classList.toggle('show');
            btn.classList.toggle('active');
        }

        function closeWechatPlusPanel() {
            const panel = document.getElementById('wechatPlusPanel');
            const btn = document.querySelector('.wechat-plus-btn');
            panel.classList.remove('show');
            btn.classList.remove('active');
        }

        // 照片选择
        function wechatSelectPhoto() {
            closeWechatPlusPanel();
            currentUploadMode = 'wechat';  // 设置模式，让预览显示在正确位置
            selectImage();
        }

        // 拍摄
        function wechatTakePhoto() {
            closeWechatPlusPanel();
            currentUploadMode = 'wechat';
            capturePhoto();
        }

        // 文件选择
        function wechatSelectFile() {
            closeWechatPlusPanel();
            currentUploadMode = 'wechat';
            selectFile();
        }

        // ========== 拍一拍功能 ==========
        let pendingPokeMessage = null;  // 暂存的拍一拍消息

        function openPokeModal() {
            closeWechatPlusPanel();
            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            if (!assistant) return;

            document.getElementById('pokeTargetName').textContent = assistant.name || '对方';
            document.getElementById('pokeSuffixInput').value = '';
            document.getElementById('pokeModalOverlay').classList.add('show');
        }

        function closePokeModal() {
            document.getElementById('pokeModalOverlay').classList.remove('show');
        }

        function confirmPoke() {
            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            if (!assistant) return;

            const suffix = document.getElementById('pokeSuffixInput').value.trim();
            const assistantName = assistant.name || '对方';

            // 构建拍一拍消息内容（格式：我 拍了拍 小克 的后缀）
            let pokeContent = `我 拍了拍 ${assistantName}`;
            if (suffix) {
                pokeContent += ` ${suffix}`;
            }

            // 创建暂存消息（使用 pat_message 类型）
            pendingPokeMessage = {
                id: 'poke_' + Date.now(),
                role: 'system',
                type: 'pat_message',
                content: pokeContent,
                timestamp: Date.now(),
                _targetAssistantId: wechatData.currentAssistantId
            };

            // 添加到暂存消息列表
            wechatData.pendingMessages.push(pendingPokeMessage);

            closePokeModal();
            renderWechatMessages();
        }

        // ========== 转账功能 ==========
        function openTransferModal() {
            closeWechatPlusPanel();
            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            if (!assistant) return;

            document.getElementById('transferTargetName').textContent = assistant.name || '对方';
            document.getElementById('transferAmountInput').value = '';
            document.getElementById('transferNoteInput').value = '';
            document.getElementById('transferModalOverlay').classList.add('show');
        }

        function closeTransferModal() {
            document.getElementById('transferModalOverlay').classList.remove('show');
        }

        function confirmTransfer() {
            const amount = parseFloat(document.getElementById('transferAmountInput').value);
            if (!amount || amount <= 0) {
                alert('请输入有效金额');
                return;
            }

            const note = document.getElementById('transferNoteInput').value.trim();
            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            const assistantName = assistant?.name || '对方';

            // 创建转账消息（兼容Ephone格式）
            const transferMsg = {
                id: 'transfer_' + Date.now(),
                role: 'user',
                type: 'transfer',
                senderName: '我',
                receiverName: assistantName,
                amount: amount,
                note: note || '',
                status: 'pending',  // pending/accepted/declined
                timestamp: Date.now(),
                _targetAssistantId: wechatData.currentAssistantId
            };

            // 添加到暂存消息
            wechatData.pendingMessages.push(transferMsg);

            closeTransferModal();
            renderWechatMessages();
        }

        // 收到转账操作相关
        let currentTransferMsgId = null;

        function showTransferActionsModal(msgId) {
            const conv = wechatData.conversations?.[wechatData.currentAssistantId];
            if (!conv) return;

            const msg = conv.messages.find(m => m.id === msgId);
            if (!msg || msg.type !== 'transfer' || msg.status !== 'pending') return;

            currentTransferMsgId = msgId;

            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            document.getElementById('transferActionsSender').textContent = msg.senderName || assistant?.name || '对方';
            document.getElementById('transferActionsAmount').textContent = `¥${msg.amount?.toFixed(2) || '0.00'}`;
            document.getElementById('transferActionsNote').textContent = msg.note || '';

            document.getElementById('transferActionsModal').classList.add('show');
        }

        function closeTransferActionsModal() {
            document.getElementById('transferActionsModal').classList.remove('show');
            currentTransferMsgId = null;
        }

        function acceptTransfer() {
            if (!currentTransferMsgId) return;

            const conv = wechatData.conversations?.[wechatData.currentAssistantId];
            if (!conv) return;

            const msg = conv.messages.find(m => m.id === currentTransferMsgId);
            if (msg) {
                msg.status = 'accepted';

                // 添加收款通知到待发送队列，随用户下次消息一起发给AI
                const receiptMsg = {
                    id: 'receipt_' + Date.now(),
                    role: 'user',
                    type: 'transfer_receipt',
                    action: 'accepted',
                    originalTransferId: msg.id,
                    amount: msg.amount,
                    senderName: msg.senderName,
                    timestamp: Date.now(),
                    _targetAssistantId: wechatData.currentAssistantId
                };
                wechatData.pendingMessages.push(receiptMsg);

                saveWechatData();
                renderWechatMessages();
            }

            closeTransferActionsModal();
        }

        function declineTransfer() {
            if (!currentTransferMsgId) return;

            const conv = wechatData.conversations?.[wechatData.currentAssistantId];
            if (!conv) return;

            const msg = conv.messages.find(m => m.id === currentTransferMsgId);
            if (msg) {
                msg.status = 'declined';

                // 添加拒收通知到待发送队列，随用户下次消息一起发给AI
                const receiptMsg = {
                    id: 'receipt_' + Date.now(),
                    role: 'user',
                    type: 'transfer_receipt',
                    action: 'declined',
                    originalTransferId: msg.id,
                    amount: msg.amount,
                    senderName: msg.senderName,
                    timestamp: Date.now(),
                    _targetAssistantId: wechatData.currentAssistantId
                };
                wechatData.pendingMessages.push(receiptMsg);

                saveWechatData();
                renderWechatMessages();
            }

            closeTransferActionsModal();
        }

        // ==================== 微信搜索功能 ====================
        const SNAPSHOT_PAGE_SIZE = 200;
        const SEARCH_PAGE_SIZE = 100;
        let wechatSearchDebounceTimer = null;
        let wechatSnapshotPage = 1;
        let wechatSearchResultPage = 1;
        let wechatSearchCurrentKeyword = '';
        let wechatSearchCachedRounds = null; // 缓存轮次数据
        let wechatSearchCachedResults = null; // 缓存搜索结果

        function openWechatSearch() {
            // 关闭+面板
            const plusPanel = document.getElementById('wechatPlusPanel');
            if (plusPanel.classList.contains('show')) {
                plusPanel.classList.remove('show');
            }

            const panel = document.getElementById('wechatSearchPanel');
            const overlay = document.getElementById('wechatSearchOverlay');
            overlay.classList.add('show');
            panel.classList.add('show');

            // 清空搜索框和状态
            document.getElementById('wechatSearchInput').value = '';
            wechatSearchCurrentKeyword = '';
            wechatSnapshotPage = 1;
            wechatSearchCachedRounds = null;
            wechatSearchCachedResults = null;

            // 渲染对话快照
            renderSnapshotList();
        }

        function closeWechatSearch() {
            const panel = document.getElementById('wechatSearchPanel');
            const overlay = document.getElementById('wechatSearchOverlay');
            panel.classList.remove('show');
            overlay.classList.remove('show');
            wechatSearchCachedRounds = null;
            wechatSearchCachedResults = null;
        }

        // 搜索输入防抖
        function onWechatSearchInput(value) {
            clearTimeout(wechatSearchDebounceTimer);
            wechatSearchDebounceTimer = setTimeout(() => {
                const keyword = value.trim();
                wechatSearchCurrentKeyword = keyword;
                if (keyword === '') {
                    wechatSnapshotPage = 1;
                    wechatSearchCachedRounds = null;
                    renderSnapshotList();
                } else {
                    wechatSearchResultPage = 1;
                    wechatSearchCachedResults = null;
                    const results = searchWechatMessages(keyword);
                    wechatSearchCachedResults = results;
                    renderSearchResults(results);
                }
            }, 300);
        }

        // 按 role 变化分割轮次
        function buildConversationRounds() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (!conv || !conv.messages.length) return [];

            const messages = conv.messages;
            const rounds = [];
            let currentRound = null;
            let prevRole = null;

            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                const role = msg.role;

                // 系统消息（拍一拍等）归到当前轮次
                if (role === 'system') {
                    if (currentRound) {
                        currentRound.messages.push(msg);
                    }
                    continue;
                }

                // role 从 user 开始新轮次
                if (role === 'user' && prevRole !== 'user') {
                    currentRound = { userMessages: [], assistantMessages: [], messages: [], timestamp: msg.timestamp };
                    rounds.push(currentRound);
                }

                if (!currentRound) {
                    currentRound = { userMessages: [], assistantMessages: [], messages: [], timestamp: msg.timestamp };
                    rounds.push(currentRound);
                }

                currentRound.messages.push(msg);
                if (role === 'user') {
                    currentRound.userMessages.push(msg);
                } else if (role === 'assistant') {
                    currentRound.assistantMessages.push(msg);
                    // 更新时间戳为最新的
                    if (msg.timestamp) currentRound.timestamp = msg.timestamp;
                }

                prevRole = role;
            }

            return rounds;
        }

        // 提取消息预览文字
        function getMessagePreview(msg) {
            if (!msg) return '';
            if (msg.type === 'image') return '[图片]';
            if (msg.type === 'transfer') return `[转账] ¥${msg.amount || ''}`;
            if (msg.type === 'pat_message') return '[拍了拍]';
            if (msg.type === 'voice_message') {
                const clean = stripInterjectionsAlways(msg.content || '');
                const text = clean.substring(0, 30);
                return '[语音] ' + text + (clean.length > 30 ? '...' : '');
            }
            return msg.content || '';
        }

        // 快照时间戳格式化
        function formatSnapshotTime(timestamp) {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            const now = new Date();
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

            const HH = String(date.getHours()).padStart(2, '0');
            const MM = String(date.getMinutes()).padStart(2, '0');
            const timeStr = `${HH}:${MM}`;

            // 今天
            if (date.toDateString() === now.toDateString()) {
                return timeStr;
            }

            // 昨天
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            if (date.toDateString() === yesterday.toDateString()) {
                return `昨天 ${timeStr}`;
            }

            // 本周内（7天内）
            if (diffDays < 7) {
                const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                return `${weekdays[date.getDay()]} ${timeStr}`;
            }

            // 今年内
            if (date.getFullYear() === now.getFullYear()) {
                const mm = String(date.getMonth() + 1).padStart(2, '0');
                const dd = String(date.getDate()).padStart(2, '0');
                return `${mm}-${dd} ${timeStr}`;
            }

            // 跨年
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            return `${date.getFullYear()}-${mm}-${dd}`;
        }

        // 渲染对话快照列表
        function renderSnapshotList(loadMore = false) {
            const container = document.getElementById('wechatSearchList');

            if (!wechatSearchCachedRounds) {
                wechatSearchCachedRounds = buildConversationRounds();
            }
            const rounds = wechatSearchCachedRounds;

            if (rounds.length === 0) {
                container.innerHTML = '<div class="wechat-search-empty">暂无聊天记录</div>';
                return;
            }

            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            const assistantName = assistant ? assistant.name : 'AI';
            const userName = appData.settings.userName || '我';

            // 倒序显示（最新在上面）
            const reversedRounds = [...rounds].reverse();
            const displayCount = wechatSnapshotPage * SNAPSHOT_PAGE_SIZE;
            const visibleRounds = reversedRounds.slice(0, displayCount);
            const hasMore = reversedRounds.length > displayCount;

            let html = '';
            visibleRounds.forEach(round => {
                const userMsg = round.userMessages[0];
                const assistantMsg = round.assistantMessages[0];
                const userPreview = userMsg ? getMessagePreview(userMsg) : '';
                const assistantPreview = assistantMsg ? getMessagePreview(assistantMsg) : '';
                const time = formatSnapshotTime(round.timestamp);
                // 点击跳转到该轮次的第一条消息
                const firstMsg = round.messages[0];
                const msgId = firstMsg ? firstMsg.id : '';

                html += `<div class="wechat-snapshot-item" onclick="jumpToWechatMessage('${msgId}')">
                    ${userPreview ? `<div class="wechat-snapshot-user">${escapeHtml(userName)}：${escapeHtml(userPreview)}</div>` : ''}
                    ${assistantPreview ? `<div class="wechat-snapshot-assistant">${escapeHtml(assistantName)}：${escapeHtml(assistantPreview)}</div>` : ''}
                    <div class="wechat-snapshot-time">${time}</div>
                </div>`;
            });

            if (hasMore) {
                html += `<div class="wechat-search-load-more" onclick="loadMoreSnapshots()">加载更多</div>`;
            }

            if (loadMore) {
                // 追加到容器
                const temp = document.createElement('div');
                temp.innerHTML = html;
                // 移除旧的加载更多按钮
                const oldLoadMore = container.querySelector('.wechat-search-load-more');
                if (oldLoadMore) oldLoadMore.remove();
                container.insertAdjacentHTML('beforeend', html);
            } else {
                container.innerHTML = html;
            }
        }

        function loadMoreSnapshots() {
            wechatSnapshotPage++;
            renderSnapshotList(true);
        }

        // 搜索消息
        function searchWechatMessages(keyword) {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (!conv || !conv.messages.length) return [];

            const lowerKeyword = keyword.toLowerCase();
            const results = [];

            for (let i = conv.messages.length - 1; i >= 0; i--) {
                const msg = conv.messages[i];
                // 跳过图片、转账回执等无文字内容的消息
                if (msg.type === 'image' || msg.type === 'transfer' || msg.type === 'pat_message') continue;
                if (!msg.content) continue;

                const content = msg.type === 'voice_message' ? stripInterjectionsAlways(msg.content) : msg.content;
                if (content.toLowerCase().includes(lowerKeyword)) {
                    results.push({ msg, index: i, content });
                }
            }

            return results;
        }

        // 渲染搜索结果
        function renderSearchResults(results, loadMore = false) {
            const container = document.getElementById('wechatSearchList');

            if (results.length === 0) {
                container.innerHTML = '<div class="wechat-search-empty">没有找到相关消息</div>';
                return;
            }

            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            const assistantName = assistant ? assistant.name : 'AI';
            const userName = appData.settings.userName || '我';
            const keyword = wechatSearchCurrentKeyword;

            const displayCount = wechatSearchResultPage * SEARCH_PAGE_SIZE;
            const visibleResults = results.slice(0, displayCount);
            const hasMore = results.length > displayCount;

            let html = '';
            visibleResults.forEach(({ msg, content }) => {
                const senderName = msg.role === 'user' ? userName : assistantName;
                const senderIcon = msg.role === 'user' ? '👤' : '🤖';
                const time = formatSnapshotTime(msg.timestamp);

                // 关键词高亮摘要
                const excerpt = buildSearchExcerpt(content, keyword);

                html += `<div class="wechat-search-result-item" onclick="jumpToWechatMessage('${msg.id}')">
                    <div class="wechat-search-result-header">
                        <span class="wechat-search-result-sender">${senderIcon} ${escapeHtml(senderName)}</span>
                        <span class="wechat-search-result-time">${time}</span>
                    </div>
                    <div class="wechat-search-result-content">${excerpt}</div>
                </div>`;
            });

            if (hasMore) {
                html += `<div class="wechat-search-load-more" onclick="loadMoreSearchResults()">加载更多（共${results.length}条）</div>`;
            }

            if (loadMore) {
                const oldLoadMore = container.querySelector('.wechat-search-load-more');
                if (oldLoadMore) oldLoadMore.remove();
                container.insertAdjacentHTML('beforeend', html);
            } else {
                container.innerHTML = html;
            }
        }

        function loadMoreSearchResults() {
            wechatSearchResultPage++;
            if (wechatSearchCachedResults) {
                renderSearchResults(wechatSearchCachedResults, true);
            }
        }

        // 构建搜索摘要（关键词前后各取约20字，关键词高亮）
        function buildSearchExcerpt(content, keyword) {
            const lowerContent = content.toLowerCase();
            const lowerKeyword = keyword.toLowerCase();
            const idx = lowerContent.indexOf(lowerKeyword);
            if (idx === -1) return escapeHtml(content.substring(0, 50));

            const start = Math.max(0, idx - 20);
            const end = Math.min(content.length, idx + keyword.length + 20);
            let excerpt = '';
            if (start > 0) excerpt += '...';
            // 分三段：前缀、关键词、后缀
            const prefix = content.substring(start, idx);
            const match = content.substring(idx, idx + keyword.length);
            const suffix = content.substring(idx + keyword.length, end);
            excerpt += escapeHtml(prefix) + `<span class="keyword-highlight">${escapeHtml(match)}</span>` + escapeHtml(suffix);
            if (end < content.length) excerpt += '...';
            return excerpt;
        }

        // 跳转到指定消息
        function jumpToWechatMessage(msgId) {
            if (!msgId) return;

            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (!conv || !conv.messages.length) return;

            const messages = conv.messages;
            const targetIndex = messages.findIndex(m => m.id === msgId);
            if (targetIndex === -1) {
                console.log('找不到目标消息:', msgId);
                return;
            }

            // 计算需要加载多少页才能包含这条消息
            const totalMessages = messages.length;
            const fromEnd = totalMessages - targetIndex; // 从末尾数过来的位置
            const neededPages = Math.ceil(fromEnd / WECHAT_PAGE_SIZE);

            // 设置页数并渲染（不滚到底部）
            wechatCurrentPage = neededPages;

            // 用特殊标记让 renderWechatMessages 不滚到底部
            wechatJumpToMsgId = msgId;
            renderWechatMessages(false);
            wechatJumpToMsgId = null;

            // 关闭搜索面板
            closeWechatSearch();

            // 渲染完成后滚动到目标消息并高亮
            // 不用 scrollIntoView，它会在 iOS PWA 里滚动整个视口导致底部露边
            requestAnimationFrame(() => {
                setTimeout(() => {
                    const targetEl = document.querySelector(`[data-msg-id="${msgId}"]`);
                    if (targetEl) {
                        const container = document.getElementById('wechatMessages');
                        const containerRect = container.getBoundingClientRect();
                        const targetRect = targetEl.getBoundingClientRect();
                        // 让目标消息滚到容器中间
                        const offset = targetRect.top - containerRect.top - (containerRect.height / 2) + (targetRect.height / 2);
                        container.scrollTop += offset;

                        targetEl.classList.add('wechat-msg-highlight');
                        targetEl.addEventListener('animationend', () => {
                            targetEl.classList.remove('wechat-msg-highlight');
                        }, { once: true });
                    }
                }, 50);
            });
        }

        let wechatJumpToMsgId = null; // 跳转标记

        // ==================== 手动语音输入（假语音） ====================
        // 打开手动语音输入弹窗
        function openFakeVoiceModal() {
            // 先关闭+面板
            const plusPanel = document.getElementById('wechatPlusPanel');
            if (plusPanel.classList.contains('show')) {
                plusPanel.classList.remove('show');
            }

            document.getElementById('fakeVoiceModal').classList.add('show');
            document.getElementById('fakeVoiceInput').value = '';
            document.getElementById('fakeVoiceSendBtn').disabled = true;
            document.getElementById('fakeVoiceInput').focus();
        }

        // 关闭手动语音输入弹窗
        function closeFakeVoiceModal() {
            document.getElementById('fakeVoiceModal').classList.remove('show');
            document.getElementById('fakeVoiceInput').value = '';
        }

        // 手动语音输入变化时更新发送按钮状态
        function onFakeVoiceInput() {
            const text = document.getElementById('fakeVoiceInput').value.trim();
            document.getElementById('fakeVoiceSendBtn').disabled = !text;
        }

        // 发送手动语音消息
        function sendFakeVoice() {
            const text = document.getElementById('fakeVoiceInput').value.trim();
            if (!text) return;

            // 创建用户语音消息（与真实语音消息格式相同）
            const voiceMsg = {
                id: 'wmsg_' + Date.now(),
                role: 'user',
                type: 'voice_message',
                content: text,
                timestamp: new Date().toISOString(),
                _targetAssistantId: wechatData.currentAssistantId
            };

            // 添加到待发送
            wechatData.pendingMessages.push(voiceMsg);

            // 关闭弹窗
            closeFakeVoiceModal();

            // 刷新显示
            renderWechatMessages();
        }

        // 为中文语音识别结果添加标点符号
        function addChinesePunctuation(text) {
            if (!text) return text;

            // 常见的疑问词
            const questionWords = ['吗', '呢', '吧', '啊', '哪', '谁', '什么', '怎么', '为什么', '几', '多少', '哪里', '哪儿', '是不是', '能不能', '会不会', '有没有', '对不对', '好不好', '行不行'];
            // 常见的感叹词
            const exclamationWords = ['啊', '呀', '哇', '哦', '嗯', '太', '真', '好', '真的', '太棒了', '太好了'];

            // 去除末尾已有的标点
            text = text.replace(/[。！？，、；：""''（）【】]+$/g, '');

            // 检查是否是疑问句
            let isQuestion = false;
            for (const word of questionWords) {
                if (text.includes(word)) {
                    isQuestion = true;
                    break;
                }
            }

            // 检查是否以疑问词结尾或包含疑问语气
            if (text.endsWith('吗') || text.endsWith('呢') || text.endsWith('吧') ||
                text.includes('什么') || text.includes('怎么') || text.includes('为什么') ||
                text.includes('是不是') || text.includes('能不能') || text.includes('有没有')) {
                return text + '？';
            }

            // 检查是否是感叹句
            if (text.endsWith('啊') || text.endsWith('呀') || text.endsWith('哇') ||
                text.includes('太') && (text.includes('了') || text.includes('啦'))) {
                return text + '！';
            }

            // 默认添加句号
            return text + '。';
        }

        // 点击语音消息播放语音
        async function playVoiceMessage(msgId) {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const settings = conv?.settings || {};
            const msg = conv?.messages?.find(m => m.id === msgId);
            
            if (!msg) return;
            
            const loadingEl = document.getElementById('voice-loading-' + msgId);
            const iconEl = document.getElementById('voice-icon-' + msgId);
            
            // 检查TTS配置
            if (!settings.ttsEnabled) {
                alert('未开启语音合成，请在聊天设置中开启');
                return;
            }
            
            if (!isTtsConfigured()) {
                alert('请先在主设置中配置语音引擎（当前引擎: ' + (appData.ttsSettings.engine || '未设置') + '）');
                return;
            }

            const isEdge = appData.ttsSettings.engine === 'edge';
            const voiceId = isEdge ? (settings.edgeVoiceId || 'zh-CN-XiaoxiaoNeural') : (settings.voiceId || 'male-qn-qingse');
            const text = msg.content;
            const emotion = msg.emotion || 'neutral';  // 从消息中获取情绪
            console.log('playVoiceMessage TTS引擎:', appData.ttsSettings.engine, 'voiceId:', voiceId);
            
            // 显示loading，隐藏图标
            if (loadingEl) loadingEl.classList.add('show');
            if (iconEl) iconEl.classList.add('hidden');
            
            try {
                await playTtsAudioWithCallback(text, voiceId, () => {
                    // loading结束，显示图标并播放动画
                    if (loadingEl) loadingEl.classList.remove('show');
                    if (iconEl) {
                        iconEl.classList.remove('hidden');
                        iconEl.classList.add('playing');
                    }
                }, () => {
                    // 播放结束，停止动画
                    if (iconEl) iconEl.classList.remove('playing');
                }, emotion);  // 传递emotion参数
            } catch (e) {
                // 出错恢复
                if (loadingEl) loadingEl.classList.remove('show');
                if (iconEl) iconEl.classList.remove('hidden');
                console.error('语音播放失败:', e);
            }
        }

        // 点击转文字展开文字内容
        function convertVoiceToText(msgId) {
            const textEl = document.getElementById('voice-text-' + msgId);
            if (textEl) {
                textEl.classList.toggle('show');
            }
        }

        // 导入助手相关函数
        function showImportAssistantModal() {
            // 渲染可导入的助手列表（排除已导入的）
            const availableAssistants = appData.assistants.filter(a => 
                !wechatData.importedAssistants.includes(a.id)
            );
            
            if (availableAssistants.length === 0) {
                if (appData.assistants.length === 0) {
                    alert('还没有创建助手，请先在设置中创建助手');
                } else {
                    alert('所有助手都已导入');
                }
                return;
            }
            
            const container = document.getElementById('importAssistantList');
            container.innerHTML = availableAssistants.map(a => `
                <div class="model-item" onclick="toggleImportSelection(this, '${a.id}')">
                    <div class="model-item-checkbox"></div>
                    <div class="model-item-info" style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--accent-light); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            ${a.avatar ? `<img src="${a.avatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}
                        </div>
                        <div class="model-item-name">${a.name}</div>
                    </div>
                </div>
            `).join('');
            
            showModal('importAssistantModal');
        }

        function toggleImportSelection(el, id) {
            el.classList.toggle('selected');
            el.dataset.assistantId = id;
        }

        function confirmImportAssistants() {
            const selectedItems = document.querySelectorAll('#importAssistantList .model-item.selected');
            const selectedIds = Array.from(selectedItems).map(el => el.dataset.assistantId);
            
            if (selectedIds.length === 0) {
                alert('请选择要导入的助手');
                return;
            }
            
            // 添加到已导入列表
            selectedIds.forEach(id => {
                if (!wechatData.importedAssistants.includes(id)) {
                    wechatData.importedAssistants.push(id);
                }
            });
            
            saveWechatData();
            hideModal('importAssistantModal');
            renderWechatList();
        }

        // 移除微信助手
        function removeWechatAssistant(assistantId) {
            if (!confirm('确定要移除这个助手吗？聊天记录将被保留。')) return;
            
            wechatData.importedAssistants = wechatData.importedAssistants.filter(id => id !== assistantId);
            saveWechatData();
            renderWechatList();
        }

        // 编辑微信消息
        function editWechatMessage(msgId) {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (!conv) return;
            
            const msg = conv.messages.find(m => m.id === msgId);
            if (msg) {
                editingWechatMessageId = msgId;
                editingWechatIsPending = false;
                document.getElementById('editWechatMessageContent').value = msg.content || '';
                showModal('editWechatMessageModal');
            }
        }

        function saveEditedWechatMessage() {
            const newContent = document.getElementById('editWechatMessageContent').value.trim();
            if (!newContent) {
                alert('消息内容不能为空');
                return;
            }

            if (editingWechatIsPending) {
                // 编辑待发消息
                const msg = wechatData.pendingMessages.find(m => m.id === editingWechatMessageId);
                if (msg) {
                    msg.content = newContent;
                    renderWechatMessages();
                }
            } else {
                // 编辑已发送消息
                const conv = wechatData.conversations[wechatData.currentAssistantId];
                if (conv) {
                    const msg = conv.messages.find(m => m.id === editingWechatMessageId);
                    if (msg) {
                        msg.content = newContent;
                        saveWechatData();
                        wechatKeepScrollPosition = document.getElementById('wechatMessages').scrollTop;
                        renderWechatMessages();
                    }
                }
            }

            hideModal('editWechatMessageModal');
            editingWechatMessageId = null;
            editingWechatIsPending = false;
        }

        // 删除微信消息
        function deleteWechatMessage(msgId) {
            if (!confirm('确定要删除这条消息吗？')) return;

            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (conv) {
                conv.messages = conv.messages.filter(m => m.id !== msgId);
                saveWechatData();
                wechatKeepScrollPosition = document.getElementById('wechatMessages').scrollTop;
                renderWechatMessages();
            }
        }

        // ========== 长按菜单和多选功能 ==========
        let wechatLongPressTimer = null;
        let wechatSelectedMsgId = null;
        let wechatMultiSelectMode = false;
        let wechatSelectedMessages = new Set();

        // 初始化长按事件
        let wechatLongPressInitialized = false;
        function initWechatLongPress() {
            if (wechatLongPressInitialized) return;
            wechatLongPressInitialized = true;

            const container = document.getElementById('wechatMessages');
            if (!container) return;

            container.addEventListener('touchstart', handleWechatTouchStart, { passive: false });
            container.addEventListener('touchend', handleWechatTouchEnd);
            container.addEventListener('touchmove', handleWechatTouchMove);
            container.addEventListener('contextmenu', handleWechatContextMenu);
            // 鼠标点击事件（PC端支持）
            container.addEventListener('click', handleWechatClick);

            // 点击其他地方关闭菜单
            document.addEventListener('click', closeWechatContextMenu);
        }

        // 处理点击事件（主要用于多选模式）
        function handleWechatClick(e) {
            if (!wechatMultiSelectMode) return;

            const msgEl = e.target.closest('.wechat-msg') || e.target.closest('.wechat-system-msg');
            if (msgEl) {
                const msgId = msgEl.getAttribute('data-msg-id');
                if (msgId) {
                    toggleWechatMessageSelect(msgId);
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        }

        function handleWechatTouchStart(e) {
            const msgEl = e.target.closest('.wechat-msg') || e.target.closest('.wechat-system-msg');
            if (!msgEl) return;

            const msgId = msgEl.getAttribute('data-msg-id');
            if (!msgId) return;

            // 系统消息（拍一拍）只支持删除，不支持多选
            const isSystemMsg = msgEl.classList.contains('wechat-system-msg');

            wechatLongPressTimer = setTimeout(() => {
                if (wechatMultiSelectMode) {
                    toggleWechatMessageSelect(msgId);
                } else {
                    showWechatContextMenu(e, msgId, isSystemMsg);
                }
                // 震动反馈
                if (navigator.vibrate) navigator.vibrate(50);
            }, 500);
        }

        function handleWechatTouchEnd(e) {
            if (wechatLongPressTimer) {
                clearTimeout(wechatLongPressTimer);
                wechatLongPressTimer = null;
            }

            // 多选模式下，点击切换选择
            if (wechatMultiSelectMode) {
                const msgEl = e.target.closest('.wechat-msg') || e.target.closest('.wechat-system-msg');
                if (msgEl) {
                    const msgId = msgEl.getAttribute('data-msg-id');
                    if (msgId) {
                        toggleWechatMessageSelect(msgId);
                        e.preventDefault();
                    }
                }
            }
        }

        function handleWechatTouchMove(e) {
            if (wechatLongPressTimer) {
                clearTimeout(wechatLongPressTimer);
                wechatLongPressTimer = null;
            }
        }

        function handleWechatContextMenu(e) {
            const msgEl = e.target.closest('.wechat-msg') || e.target.closest('.wechat-system-msg');
            if (msgEl) {
                e.preventDefault();
                const msgId = msgEl.getAttribute('data-msg-id');
                const isSystemMsg = msgEl.classList.contains('wechat-system-msg');
                if (msgId && !wechatMultiSelectMode) {
                    showWechatContextMenu(e, msgId, isSystemMsg);
                }
            }
        }

        function showWechatContextMenu(e, msgId, isSystemMsg = false) {
            wechatSelectedMsgId = msgId;
            const menu = document.getElementById('wechatContextMenu');

            // 系统消息（拍一拍）隐藏引用和编辑，保留多选和删除
            document.getElementById('wechatMenuQuote').style.display = isSystemMsg ? 'none' : '';
            document.getElementById('wechatMenuEdit').style.display = isSystemMsg ? 'none' : '';
            document.getElementById('wechatMenuReplace').style.display = isSystemMsg ? 'none' : '';
            document.getElementById('wechatMenuInspiration').style.display = isSystemMsg ? 'none' : '';

            // 计算位置
            let x = e.touches ? e.touches[0].clientX : e.clientX;
            let y = e.touches ? e.touches[0].clientY : e.clientY;

            menu.classList.add('show');

            // 确保菜单不超出屏幕
            const rect = menu.getBoundingClientRect();
            if (x + rect.width > window.innerWidth) {
                x = window.innerWidth - rect.width - 10;
            }
            if (y + rect.height > window.innerHeight) {
                y = window.innerHeight - rect.height - 10;
            }

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
        }

        function closeWechatContextMenu(e) {
            const menu = document.getElementById('wechatContextMenu');
            if (menu && !menu.contains(e?.target)) {
                menu.classList.remove('show');
            }
        }

        function wechatCopyMessage() {
            closeWechatContextMenu();
            if (!wechatSelectedMsgId) return;

            // 从已发送消息或待发消息中查找
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            let msg = conv?.messages?.find(m => m.id === wechatSelectedMsgId);
            if (!msg) msg = wechatData.pendingMessages.find(m => m.id === wechatSelectedMsgId);
            if (!msg || !msg.content) return;

            const text = msg.type === 'voice_message' ? stripInterjectionsAlways(msg.content) : msg.content;
            navigator.clipboard.writeText(text).then(() => {
                // 简单的复制成功提示
                const el = document.querySelector(`[data-msg-id="${wechatSelectedMsgId}"]`);
                if (el) {
                    const tip = document.createElement('div');
                    tip.textContent = '已复制';
                    tip.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.7);color:#fff;padding:8px 20px;border-radius:8px;font-size:14px;z-index:99999;';
                    document.body.appendChild(tip);
                    setTimeout(() => tip.remove(), 1000);
                }
            }).catch(() => {});
        }

        function wechatEditSelectedMessage() {
            closeWechatContextMenu();
            if (wechatSelectedMsgId) {
                // 检查是否是待发消息
                const pendingMsg = wechatData.pendingMessages.find(m => m.id === wechatSelectedMsgId);
                if (pendingMsg) {
                    editWechatPendingMessage(wechatSelectedMsgId);
                } else {
                    editWechatMessage(wechatSelectedMsgId);
                }
            }
        }

        function wechatDeleteSelectedMessage() {
            closeWechatContextMenu();
            if (wechatSelectedMsgId) {
                // 检查是否是待发消息
                const pendingIdx = wechatData.pendingMessages.findIndex(m => m.id === wechatSelectedMsgId);
                if (pendingIdx !== -1) {
                    deleteWechatPendingMessage(wechatSelectedMsgId);
                } else {
                    deleteWechatMessage(wechatSelectedMsgId);
                }
            }
        }

        // ========== 文本替换功能 ==========
        let _lastReplaceFrom = '';
        let _lastReplaceTo = '';

        function wechatOpenTextReplace() {
            closeWechatContextMenu();
            if (!wechatSelectedMsgId) return;

            // 找到消息
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const msg = conv?.messages?.find(m => m.id === wechatSelectedMsgId);
            if (!msg || !msg.content) return;

            // 填入上次的替换对
            document.getElementById('textReplaceFrom').value = _lastReplaceFrom;
            document.getElementById('textReplaceTo').value = _lastReplaceTo;
            document.getElementById('textReplaceModal').classList.add('show');
            updateReplacePreview();

            // 自动聚焦到查找框
            setTimeout(() => document.getElementById('textReplaceFrom').focus(), 100);
        }

        function closeTextReplaceModal() {
            document.getElementById('textReplaceModal').classList.remove('show');
        }

        function updateReplacePreview() {
            const from = document.getElementById('textReplaceFrom').value;
            const preview = document.getElementById('textReplacePreview');

            if (!from || !wechatSelectedMsgId) {
                preview.textContent = '';
                return;
            }

            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const msg = conv?.messages?.find(m => m.id === wechatSelectedMsgId);
            if (!msg || !msg.content) { preview.textContent = ''; return; }

            const count = msg.content.split(from).length - 1;
            preview.textContent = count > 0 ? `找到 ${count} 处匹配` : '未找到匹配';
            preview.style.color = count > 0 ? '#576b95' : '#999';
        }

        function confirmTextReplace() {
            const from = document.getElementById('textReplaceFrom').value;
            const to = document.getElementById('textReplaceTo').value;

            if (!from) {
                alert('请填写要查找的文本');
                return;
            }

            if (!wechatSelectedMsgId) return;

            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const msg = conv?.messages?.find(m => m.id === wechatSelectedMsgId);
            if (!msg || !msg.content) return;

            const count = msg.content.split(from).length - 1;
            if (count === 0) {
                alert('未找到匹配的文本');
                return;
            }

            // 执行替换
            msg.content = msg.content.replaceAll(from, to);

            // 记住这次的替换对
            _lastReplaceFrom = from;
            _lastReplaceTo = to;

            closeTextReplaceModal();
            wechatKeepScrollPosition = document.getElementById('wechatMessages').scrollTop;
            saveWechatData();
            renderWechatMessages();

            // 提示
            const tip = document.createElement('div');
            tip.textContent = `已替换 ${count} 处`;
            tip.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.7);color:#fff;padding:8px 20px;border-radius:8px;font-size:14px;z-index:99999;';
            document.body.appendChild(tip);
            setTimeout(() => tip.remove(), 1500);
        }

        // ========== 待发消息编辑/删除 ==========
        function editWechatPendingMessage(msgId) {
            const msg = wechatData.pendingMessages.find(m => m.id === msgId);
            if (msg && (msg.type === 'text' || msg.type === 'voice_message')) {
                // 复用编辑消息弹窗
                editingWechatMessageId = msgId;
                editingWechatIsPending = true;
                document.getElementById('editWechatMessageContent').value = msg.content || '';
                showModal('editWechatMessageModal');
            } else if (msg) {
                alert('此类型消息不支持编辑');
            }
        }
        let editingWechatIsPending = false;

        function deleteWechatPendingMessage(msgId) {
            const idx = wechatData.pendingMessages.findIndex(m => m.id === msgId);
            if (idx !== -1) {
                wechatData.pendingMessages.splice(idx, 1);
                renderWechatMessages();
            }
        }

        // ========== 引用消息功能 ==========
        let wechatQuotedMessage = null;

        function wechatQuoteMessage() {
            closeWechatContextMenu();
            if (!wechatSelectedMsgId) return;

            // 从已发送消息或待发消息中查找
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            let msg = conv?.messages?.find(m => m.id === wechatSelectedMsgId);
            if (!msg) {
                msg = wechatData.pendingMessages.find(m => m.id === wechatSelectedMsgId);
            }
            if (!msg) return;

            // 获取发送者名字
            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            let senderName = msg.role === 'user' ? '我' : (assistant?.name || '助手');

            // 获取消息内容预览
            let contentPreview = '';
            if (msg.type === 'image') {
                contentPreview = '[图片]';
            } else if (msg.type === 'voice_message') {
                // 语音消息显示实际内容
                const voiceClean = stripInterjectionsAlways(msg.content || '');
                const voiceContent = voiceClean.substring(0, 50);
                contentPreview = '[语音] ' + voiceContent + (voiceClean.length > 50 ? '...' : '');
            } else if (msg.type === 'transfer') {
                contentPreview = `[转账] ¥${msg.amount}`;
            } else if (msg.type === 'transfer_receipt') {
                contentPreview = msg.action === 'accepted' ? `[已收款] ¥${msg.amount}` : `[已退还] ¥${msg.amount}`;
            } else if (msg.type === 'pat_message') {
                contentPreview = msg.content;
            } else {
                contentPreview = msg.content?.substring(0, 50) || '';
                if (msg.content?.length > 50) contentPreview += '...';
            }

            // 计算发送给助手的完整引用内容（不截断文本和语音内容）
            let fullQuoteContent = contentPreview;  // 默认使用预览
            if (msg.type === 'voice_message' || msg.type === 'text' || !msg.type) {
                // 文本和语音消息：发送完整内容给助手
                fullQuoteContent = msg.content || '';
            }
            // 其他类型（图片、转账等）保持预览格式

            wechatQuotedMessage = {
                id: msg.id,
                senderName: senderName,
                content: contentPreview,           // 用于UI显示（可截断）
                fullContent: fullQuoteContent,     // 用于发送给助手（完整内容）
                originalContent: msg.content,
                type: msg.type
            };

            // 显示引用预览
            document.getElementById('wechatQuotePreviewName').textContent = senderName + '：';
            document.getElementById('wechatQuotePreviewContent').textContent = stripInterjectionsAlways(contentPreview);
            document.getElementById('wechatQuotePreview').classList.add('show');

            // 聚焦输入框
            document.getElementById('wechatInput').focus();
        }

        function clearWechatQuote() {
            wechatQuotedMessage = null;
            document.getElementById('wechatQuotePreview').classList.remove('show');
        }

        function enterWechatMultiSelect() {
            closeWechatContextMenu();
            wechatMultiSelectMode = true;
            wechatSelectedMessages.clear();

            // 预选当前长按的消息
            if (wechatSelectedMsgId) {
                wechatSelectedMessages.add(wechatSelectedMsgId);
            }

            document.getElementById('wechatMessages').classList.add('wechat-multiselect-mode');
            document.getElementById('wechatMultiselectBar').classList.add('show');
            updateWechatSelectedCount();
            wechatKeepScrollPosition = document.getElementById('wechatMessages').scrollTop;
            renderWechatMessages();
        }

        function exitWechatMultiSelect() {
            wechatMultiSelectMode = false;
            wechatSelectedMessages.clear();
            document.getElementById('wechatMessages').classList.remove('wechat-multiselect-mode');
            document.getElementById('wechatMultiselectBar').classList.remove('show');
            wechatKeepScrollPosition = document.getElementById('wechatMessages').scrollTop;
            renderWechatMessages();
        }

        function toggleWechatMessageSelect(msgId) {
            if (wechatSelectedMessages.has(msgId)) {
                wechatSelectedMessages.delete(msgId);
            } else {
                wechatSelectedMessages.add(msgId);
            }
            updateWechatSelectedCount();

            // 更新UI
            const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
            if (msgEl) {
                msgEl.classList.toggle('selected', wechatSelectedMessages.has(msgId));
            }
        }

        function updateWechatSelectedCount() {
            document.getElementById('wechatSelectedCount').textContent = `已选择 ${wechatSelectedMessages.size} 条`;
        }

        function deleteWechatSelectedMessages() {
            if (wechatSelectedMessages.size === 0) {
                alert('请先选择要删除的消息');
                return;
            }

            if (!confirm(`确定要删除选中的 ${wechatSelectedMessages.size} 条消息吗？`)) return;

            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (conv) {
                conv.messages = conv.messages.filter(m => !wechatSelectedMessages.has(m.id));
                saveWechatData();
            }

            exitWechatMultiSelect();
        }

        // 导出格式弹窗
        let _exportCallback = null;
        function showExportFormatModal(callback) {
            _exportCallback = callback;
            document.getElementById('exportFormatModal').classList.add('show');
        }
        function closeExportFormatModal() {
            document.getElementById('exportFormatModal').classList.remove('show');
            _exportCallback = null;
        }
        function confirmExportFormat(format) {
            const cb = _exportCallback;  // 先保存回调引用
            closeExportFormatModal();     // 关弹窗（会清空_exportCallback）
            if (cb) cb(format);           // 用保存的引用执行回调
        }

        function exportWechatSelectedMessages() {
            if (wechatSelectedMessages.size === 0) {
                alert('请先选择要导出的消息');
                return;
            }

            showExportFormatModal(function(format) {
                const conv = wechatData.conversations[wechatData.currentAssistantId];
                if (!conv) return;

                const selected = conv.messages.filter(m => wechatSelectedMessages.has(m.id));
                const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
                const assistantName = assistant ? assistant.name : '助手';

                // 生成引用前缀
                function quotePrefix(m, style) {
                    if (!m.quote) return '';
                    const who = m.quote.senderName || '';
                    const what = (m.quote.content || '').substring(0, 100);
                    if (style === 'md') return `> 引用 ${who}：${what}\n\n`;
                    if (style === 'txt') return `[引用 ${who}："${what}"]\n`;
                    return '';
                }

                if (format === 'json') {
                    const exportData = selected.map(m => {
                        const obj = { role: m.role === 'user' ? '我' : assistantName, content: m.content, time: m.timestamp };
                        if (m.type && m.type !== 'text') obj.type = m.type;
                        if (m.quote) obj.quote = { senderName: m.quote.senderName, content: m.quote.content };
                        return obj;
                    });
                    const json = JSON.stringify(exportData, null, 2);
                    downloadFile(json, `聊天记录_${assistantName}_${new Date().toISOString().slice(0,10)}.json`, 'application/json');
                } else if (format === 'txt') {
                    let txt = `聊天记录 - ${assistantName}\n\n`;
                    let lastDate = '';
                    for (const m of selected) {
                        const dt = new Date(m.timestamp);
                        const date = dt.toLocaleDateString('zh-CN');
                        if (date !== lastDate) { txt += `--- ${date} ---\n\n`; lastDate = date; }
                        const time = dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                        const name = m.role === 'user' ? '我' : assistantName;
                        const content = m.type === 'image' ? '[图片]' : (m.content || '');
                        txt += `${name} (${time})\n${quotePrefix(m, 'txt')}${content}\n\n`;
                    }
                    downloadFile(txt, `聊天记录_${assistantName}_${new Date().toISOString().slice(0,10)}.txt`, 'text/plain');
                } else {
                    let md = `# 聊天记录 - ${assistantName}\n\n`;
                    let lastDate = '';
                    for (const m of selected) {
                        const dt = new Date(m.timestamp);
                        const date = dt.toLocaleDateString('zh-CN');
                        if (date !== lastDate) { md += `## ${date}\n\n`; lastDate = date; }
                        const time = dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                        const name = m.role === 'user' ? '我' : assistantName;
                        const content = m.type === 'image' ? '[图片]' : (m.content || '');
                        md += `**${name}** (${time})\n\n${quotePrefix(m, 'md')}${content}\n\n---\n\n`;
                    }
                    downloadFile(md, `聊天记录_${assistantName}_${new Date().toISOString().slice(0,10)}.md`, 'text/markdown');
                }

                exitWechatMultiSelect();
            });
        }
