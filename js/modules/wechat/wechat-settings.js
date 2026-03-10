/**
 * 微信模式 - 聊天设置
 *
 * 负责：聊天设置页面、主题/壁纸/背景/气泡透明度、图案选择
 * 暴露函数：openWechatChatSettings, saveWechatChatSettings, closeWechatChatSettings,
 *           applyWechatTheme, applyWechatPattern, selectWechatBackground,
 *           clearWechatChatBackground
 * 依赖：appData(data.js), wechatData/saveWechatData(wechat-core.js),
 *        openPage/closePage(navigation.js), compressImage(image.js),
 *        toggleVoiceIdFields/populateEdgeVoiceSelect/getEdgeVoiceGender(tts.js)
 */


        // 聊天设置
        function openWechatChatSettings() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const settings = conv ? conv.settings : {};
            const messages = conv ? conv.messages || [] : [];

            // 显示当前对话条数
            document.getElementById('wechatMsgCount').textContent = messages.length + ' 条';

            document.getElementById('wechatMemoryCount').value = settings.memoryCount || 20;
            // 时间感知总开关（默认开启）
            const timeAwareOn = settings.timeAware !== false;
            document.getElementById('wechatTimeAware').classList.toggle('on', timeAwareOn);
            document.getElementById('wechatOfflineMode').classList.toggle('on', settings.offlineMode || false);
            document.getElementById('wechatTtsEnabled').classList.toggle('on', settings.ttsEnabled || false);
            document.getElementById('wechatEmotionEnabled').classList.toggle('on', settings.emotionEnabled !== false); // 默认开启
            document.getElementById('wechatVoiceId').value = settings.voiceId || '';

            // Edge TTS 音色 UI
            if (appData.ttsSettings.engine === 'edge') {
                const currentVoice = settings.edgeVoiceId || 'zh-CN-XiaoxiaoNeural';
                document.getElementById('wechatEdgeGender').value = getEdgeVoiceGender(currentVoice);
                populateEdgeVoiceSelect('wechatEdgeVoice', 'wechatEdgeGender', currentVoice);
            }
            toggleVoiceIdFields();

            // 主动发消息设置
            document.getElementById('wechatProactive').classList.toggle('on', settings.proactiveEnabled || false);
            document.getElementById('wechatProactiveInterval').value = settings.proactiveInterval || 15;
            updateProactiveIntervalVisibility();

            // 长期记忆设置
            document.getElementById('wechatLongTermMemoryEnabled').classList.toggle('on', settings.longTermMemoryEnabled !== false); // 默认开启
            document.getElementById('wechatAutoSummaryEnabled').classList.toggle('on', settings.autoSummaryEnabled || false);
            document.getElementById('wechatAutoSummaryInterval').value = settings.autoSummaryInterval || 50;

            // 向量记忆设置
            document.getElementById('wechatVectorMemoryChat').classList.toggle('on', settings.vectorMemoryChatEnabled || false);

            // 当日总结注入
            document.getElementById('wechatDailySummaryInject').classList.toggle('on', settings.dailySummaryInjectEnabled || false);

            // 背景图案
            const pattern = settings.pattern || 'none';
            document.querySelectorAll('.wechat-pattern-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.pattern === pattern);
            });
            // 自定义背景预览和删除按钮
            const customPreview = document.getElementById('wechatCustomPatternPreview');
            const customOption = document.getElementById('wechatCustomPatternOption');
            if (settings.chatBackground) {
                customPreview.style.backgroundImage = `url(${settings.chatBackground})`;
                customPreview.style.backgroundSize = 'cover';
                customPreview.innerHTML = '<span class="custom-delete-btn" onclick="event.stopPropagation(); clearWechatChatBackground()">×</span>';
                customOption.classList.add('has-custom');
            } else {
                customPreview.style.backgroundImage = '';
                customPreview.style.backgroundSize = '';
                customPreview.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span class="custom-delete-btn" onclick="event.stopPropagation(); clearWechatChatBackground()">×</span>';
                customOption.classList.remove('has-custom');
            }

            // 统计图片数量（图片数据在content字段）
            const imageCount = (conv?.messages || []).filter(m => m.type === 'image' && m.content && m.content.startsWith('data:')).length;
            document.getElementById('wechatImageCacheCount').textContent = imageCount + ' 张';

            // 统计文件数量（排除已清除的）
            const fileCount = (conv?.messages || []).filter(m => m.isFile && m.content && !m.content.includes('（内容已清除）')).length;
            document.getElementById('wechatFileCacheCount').textContent = fileCount + ' 个';

            // 主题颜色
            const theme = settings.theme || 'default';
            document.querySelectorAll('#wechatThemeSelector .wechat-theme-dot').forEach(dot => {
                dot.classList.toggle('active', dot.dataset.theme === theme);
            });

            // 气泡透明度
            const opacity = settings.bubbleOpacity ?? 100;
            document.getElementById('wechatBubbleOpacity').value = opacity;
            document.getElementById('wechatBubbleOpacityValue').textContent = opacity + '%';

            openPage('wechatSettingsPage');
        }

        function saveWechatChatSettings() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (conv) {
                // 获取选中的图案
                const activePattern = document.querySelector('.wechat-pattern-option.active');
                const pattern = activePattern ? activePattern.dataset.pattern : 'none';

                // 获取选中的主题
                const activeTheme = document.querySelector('#wechatThemeSelector .wechat-theme-dot.active');
                const theme = activeTheme ? activeTheme.dataset.theme : 'default';

                conv.settings = {
                    ...conv.settings,
                    memoryCount: parseInt(document.getElementById('wechatMemoryCount').value) || 20,
                    timeAware: document.getElementById('wechatTimeAware').classList.contains('on'),
                    offlineMode: document.getElementById('wechatOfflineMode').classList.contains('on'),
                    ttsEnabled: document.getElementById('wechatTtsEnabled').classList.contains('on'),
                    emotionEnabled: document.getElementById('wechatEmotionEnabled').classList.contains('on'),
                    voiceId: document.getElementById('wechatVoiceId').value.trim(),
                    edgeVoiceId: document.getElementById('wechatEdgeVoice').value || 'zh-CN-XiaoxiaoNeural',
                    longTermMemoryEnabled: document.getElementById('wechatLongTermMemoryEnabled').classList.contains('on'),
                    autoSummaryEnabled: document.getElementById('wechatAutoSummaryEnabled').classList.contains('on'),
                    autoSummaryInterval: parseInt(document.getElementById('wechatAutoSummaryInterval').value) || 50,
                    vectorMemoryChatEnabled: document.getElementById('wechatVectorMemoryChat').classList.contains('on'),
                    dailySummaryInjectEnabled: document.getElementById('wechatDailySummaryInject').classList.contains('on'),
                    proactiveEnabled: document.getElementById('wechatProactive').classList.contains('on'),
                    proactiveInterval: parseInt(document.getElementById('wechatProactiveInterval').value) || 15,
                    pattern: pattern,
                    theme: theme,
                    bubbleOpacity: parseInt(document.getElementById('wechatBubbleOpacity').value ?? 100)
                };
                saveWechatData();
                applyWechatPattern();
                applyWechatTheme();
                applyBubbleOpacity();
            }
            closePage('wechatSettingsPage');
        }

        // 微信背景图案选择
        function selectWechatPattern(pattern) {
            document.querySelectorAll('.wechat-pattern-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.pattern === pattern);
            });
            // 如果选择custom，会触发文件选择
        }

        // 微信主题颜色选择（聊天设置页）
        function selectWechatTheme(theme) {
            document.querySelectorAll('#wechatThemeSelector .wechat-theme-dot').forEach(dot => {
                dot.classList.toggle('active', dot.dataset.theme === theme);
            });
            // 实时预览主题
            const chatPage = document.getElementById('wechatChatPage');
            if (chatPage) {
                if (theme === 'default') {
                    chatPage.removeAttribute('data-wechat-theme');
                } else {
                    chatPage.setAttribute('data-wechat-theme', theme);
                }
            }
            // 同时更新透明度（使用当前滑块值）
            const opacity = parseInt(document.getElementById('wechatBubbleOpacity').value) || 100;
            previewWechatBubbleOpacityWithTheme(opacity, theme);
        }

        // 微信气泡透明度预览（聊天设置页）
        function previewWechatBubbleOpacity(value) {
            document.getElementById('wechatBubbleOpacityValue').textContent = value + '%';
            // 获取当前选中的主题
            const activeTheme = document.querySelector('#wechatThemeSelector .wechat-theme-dot.active');
            const theme = activeTheme ? activeTheme.dataset.theme : 'default';
            previewWechatBubbleOpacityWithTheme(value, theme);
        }

        // 带主题参数的透明度预览
        function previewWechatBubbleOpacityWithTheme(value, theme) {
            const opacity = parseInt(value) / 100;
            const colors = themeColors[theme] || themeColors['default'];
            const userBubbleRgba = `rgba(${colors.userBubble.join(',')}, ${opacity})`;
            const aiBubbleRgba = `rgba(${colors.aiBubble.join(',')}, ${opacity})`;
            const chatPage = document.getElementById('wechatChatPage');
            if (chatPage) {
                chatPage.style.setProperty('--wechat-user-bubble', userBubbleRgba);
                chatPage.style.setProperty('--wechat-ai-bubble', aiBubbleRgba);
            }
        }

        // 应用微信主题（从当前对话设置）
        function applyWechatTheme() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const theme = conv?.settings?.theme || 'default';
            const chatPage = document.getElementById('wechatChatPage');
            if (chatPage) {
                if (theme === 'default') {
                    chatPage.removeAttribute('data-wechat-theme');
                } else {
                    chatPage.setAttribute('data-wechat-theme', theme);
                }
            }
        }

        // 应用微信背景图案
        function applyWechatPattern() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const pattern = conv?.settings?.pattern || 'none';
            const messagesEl = document.getElementById('wechatMessages');
            if (messagesEl) {
                if (pattern === 'custom' && conv?.settings?.chatBackground) {
                    messagesEl.setAttribute('data-pattern', 'custom');
                    messagesEl.style.backgroundImage = `url(${conv.settings.chatBackground})`;
                } else if (pattern !== 'none') {
                    messagesEl.setAttribute('data-pattern', pattern);
                    messagesEl.style.backgroundImage = '';
                } else {
                    messagesEl.removeAttribute('data-pattern');
                    messagesEl.style.backgroundImage = '';
                }
            }
        }

        // ==================== 微信背景图片设置 ====================
        function selectWechatBackground() {
            document.getElementById('wechatBgInput').click();
        }

        async function handleWechatBgUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                alert('请选择图片文件');
                return;
            }

            // 压缩图片到合适大小（小于500KB不压缩）
            const base64 = await compressImage(file, 500, 1200);

            // 保存到当前会话设置
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (conv) {
                conv.settings = conv.settings || {};
                conv.settings.chatBackground = base64;
                conv.settings.pattern = 'custom';
                saveWechatData();

                // 更新图案选择器
                document.querySelectorAll('.wechat-pattern-option').forEach(opt => {
                    opt.classList.toggle('active', opt.dataset.pattern === 'custom');
                });
                // 更新自定义预览
                const customPreview = document.getElementById('wechatCustomPatternPreview');
                customPreview.style.backgroundImage = `url(${base64})`;
                customPreview.style.backgroundSize = 'cover';
                customPreview.innerHTML = '<span class="custom-delete-btn" onclick="event.stopPropagation(); clearWechatChatBackground()">×</span>';
                document.getElementById('wechatCustomPatternOption').classList.add('has-custom');

                applyWechatPattern();
            }
            event.target.value = '';
        }

        function clearWechatChatBackground() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (conv && conv.settings) {
                conv.settings.chatBackground = null;
                conv.settings.pattern = 'none';
                saveWechatData();

                // 更新图案选择器
                document.querySelectorAll('.wechat-pattern-option').forEach(opt => {
                    opt.classList.toggle('active', opt.dataset.pattern === 'none');
                });
                // 重置自定义预览
                const customPreview = document.getElementById('wechatCustomPatternPreview');
                customPreview.style.backgroundImage = '';
                customPreview.style.backgroundSize = '';
                customPreview.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span class="custom-delete-btn" onclick="event.stopPropagation(); clearWechatChatBackground()">×</span>';
                document.getElementById('wechatCustomPatternOption').classList.remove('has-custom');

                applyWechatPattern();
            }
        }

        function updateWechatBgPreview() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const bg = conv?.settings?.chatBackground;
            const previewItem = document.getElementById('wechatBgPreviewItem');
            const preview = document.getElementById('wechatBgPreview');
            const status = document.getElementById('wechatBgStatus');

            if (bg) {
                previewItem.style.display = 'flex';
                preview.style.backgroundImage = `url(${bg})`;
                status.textContent = '已设置';
            } else {
                previewItem.style.display = 'none';
                status.textContent = '默认';
            }
        }

        function clearWechatBackground() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (conv && conv.settings) {
                delete conv.settings.chatBackground;
                saveWechatData();
                updateWechatBgPreview();
                applyWechatBackground();
            }
        }

        function applyWechatBackground() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const bg = conv?.settings?.chatBackground;
            const messagesEl = document.getElementById('wechatMessages');
            if (messagesEl) {
                if (bg) {
                    messagesEl.style.backgroundImage = `url(${bg})`;
                    messagesEl.style.backgroundSize = 'cover';
                    messagesEl.style.backgroundPosition = 'center';
                } else {
                    messagesEl.style.backgroundImage = '';
                    messagesEl.style.backgroundSize = '';
                    messagesEl.style.backgroundPosition = '';
                }
            }
        }
