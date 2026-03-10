/**
 * 显示设置模块
 *
 * 负责：字体/字号选择、用户头像/壁纸上传、气泡透明度、助手头像上传
 * 暴露函数：openDisplaySettings, previewFont, previewFontSize, saveDisplaySettings,
 *           applyFont, applyFontSize, handleUserAvatarUpload, clearUserAvatar, applyUserAvatar,
 *           applyBubbleOpacity, selectWallpaper, handleWallpaperUpload, clearCustomWallpaper,
 *           applyWallpaper, handleAssistantAvatarUpload, clearAssistantAvatar,
 *           initDisplaySettings, updateSettingsCounts
 * 依赖：appData (data.js), saveData (storage.js), openPage/closePage (navigation.js),
 *        compressImage (image.js), applyWechatTheme (微信模块，运行时引用),
 *        wechatData (微信模块，运行时引用)
 */

        const fontMap = {
            'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
            'naikai': '"NaikaiFont", -apple-system, BlinkMacSystemFont, sans-serif',
            'moonstars': '"MoonStarsKai", -apple-system, BlinkMacSystemFont, sans-serif',
            'jason': '"JasonHandwriting", -apple-system, BlinkMacSystemFont, sans-serif',
            'pingfang': '"PingfangShiguang", -apple-system, BlinkMacSystemFont, sans-serif',
            'cococheese': '"cococheese", -apple-system, BlinkMacSystemFont, sans-serif',
            'zcool': '"ZCOOL KuaiLe", -apple-system, BlinkMacSystemFont, sans-serif',
            'ZLabsBitmap': '"ZLabsBitmap", -apple-system, BlinkMacSystemFont, sans-serif',
            'ZZJmarkpen': '"ZZJmarkpen", -apple-system, BlinkMacSystemFont, sans-serif',
            'KURIYAMAKOUCHI': '"KURIYAMAKOUCHI", -apple-system, BlinkMacSystemFont, sans-serif'
        };

        function openDisplaySettings() {
            // 加载字体设置
            const currentFont = appData.settings.chatFont || 'system';
            document.getElementById('displayFontSelector').value = currentFont;
            previewFont(currentFont);

            // 加载字体大小
            const currentFontSize = appData.settings.chatFontSize || 15;
            document.getElementById('displayFontSizeSlider').value = currentFontSize;
            document.getElementById('fontSizeValue').textContent = currentFontSize;
            document.getElementById('fontPreview').style.fontSize = currentFontSize + 'px';

            // 加载用户头像
            const userAvatar = appData.settings.userAvatar || '';
            const previewEl = document.getElementById('userAvatarPreview');
            if (userAvatar) {
                previewEl.innerHTML = `<img src="${userAvatar}" alt="">`;
                previewEl.classList.add('has-image');
            } else {
                previewEl.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
                previewEl.classList.remove('has-image');
            }

            // 加载用户名
            document.getElementById('displayUserName').value = appData.settings.userName || '';

            // 加载壁纸设置
            const wallpaper = appData.settings.wallpaper || 'default';
            document.querySelectorAll('.wallpaper-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.wallpaper === wallpaper);
            });
            const customWallpaperOption = document.getElementById('customWallpaperOption');
            const customWallpaperPreview = document.getElementById('customWallpaperPreview');
            if (appData.settings.customWallpaper) {
                customWallpaperPreview.style.backgroundImage = `url(${appData.settings.customWallpaper})`;
                customWallpaperPreview.innerHTML = '<span class="custom-delete-btn" onclick="event.stopPropagation(); clearCustomWallpaper()">×</span>';
                customWallpaperOption.classList.add('has-custom');
            } else {
                customWallpaperPreview.style.backgroundImage = '';
                customWallpaperPreview.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span class="custom-delete-btn" onclick="event.stopPropagation(); clearCustomWallpaper()">×</span>';
                customWallpaperOption.classList.remove('has-custom');
            }

            openPage('displaySettingsPage');
        }

        function previewFont(fontKey) {
            const fontFamily = fontMap[fontKey] || fontMap['system'];
            document.getElementById('fontPreview').style.fontFamily = fontFamily;
        }

        function previewFontSize(size) {
            document.getElementById('fontSizeValue').textContent = size;
            document.getElementById('fontPreview').style.fontSize = size + 'px';
        }

        function saveDisplaySettings() {
            const fontKey = document.getElementById('displayFontSelector').value;
            const userName = document.getElementById('displayUserName').value.trim();
            const fontSize = parseInt(document.getElementById('displayFontSizeSlider').value) || 15;

            appData.settings.chatFont = fontKey;
            appData.settings.chatFontSize = fontSize;
            appData.settings.userName = userName;

            applyFont(fontKey);
            applyFontSize(fontSize);
            applyWallpaper();
            applyUserAvatar();
            saveData();
            closePage('displaySettingsPage');
        }

        function applyFont(fontKey) {
            const fontFamily = fontMap[fontKey] || fontMap['system'];
            document.documentElement.style.setProperty('--chat-font', fontFamily);
        }

        function applyFontSize(size) {
            document.documentElement.style.setProperty('--chat-font-size', (size || 15) + 'px');
        }

        // 用户头像上传处理（自动压缩）
        async function handleUserAvatarUpload(input) {
            const file = input.files[0];
            if (!file) return;

            const base64 = await compressImage(file, 200, 200);
            appData.settings.userAvatar = base64;
            const previewEl = document.getElementById('userAvatarPreview');
            previewEl.innerHTML = `<img src="${base64}" alt="">`;
            previewEl.classList.add('has-image');
        }

        function clearUserAvatar() {
            appData.settings.userAvatar = '';
            const previewEl = document.getElementById('userAvatarPreview');
            previewEl.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
            previewEl.classList.remove('has-image');
        }

        function applyUserAvatar() {
            // 用户头像会在renderMessage时动态应用
        }

        // 气泡透明度
        // 气泡颜色配置（用于透明度计算）
        const themeColors = {
            'default': { userBubble: [149, 236, 105], aiBubble: [255, 255, 255] },
            'pink': { userBubble: [245, 213, 216], aiBubble: [255, 255, 255] },
            'blue': { userBubble: [197, 204, 232], aiBubble: [238, 240, 248] },
            'purple': { userBubble: [221, 212, 232], aiBubble: [243, 240, 248] },
            'brown': { userBubble: [217, 207, 197], aiBubble: [243, 238, 234] },
            'dark': { userBubble: [90, 122, 148], aiBubble: [45, 51, 57] },
            'red': { userBubble: [232, 180, 182], aiBubble: [250, 240, 240] }
        };

        function applyBubbleOpacity() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const opacity = (conv?.settings?.bubbleOpacity ?? 100) / 100;
            const theme = conv?.settings?.theme || 'default';
            const colors = themeColors[theme] || themeColors['default'];

            const userBubbleRgba = `rgba(${colors.userBubble.join(',')}, ${opacity})`;
            const aiBubbleRgba = `rgba(${colors.aiBubble.join(',')}, ${opacity})`;

            // 设置在chatPage上以覆盖主题选择器的CSS变量
            const chatPage = document.getElementById('wechatChatPage');
            if (chatPage) {
                chatPage.style.setProperty('--wechat-user-bubble', userBubbleRgba);
                chatPage.style.setProperty('--wechat-ai-bubble', aiBubbleRgba);
            }
        }

        // 壁纸选择
        const wallpaperStyles = {
            'default': 'linear-gradient(135deg, #fdf6f9 0%, #f5ede8 50%, #faf5f0 100%)',
            'pink': 'linear-gradient(135deg, #ffe4ec 0%, #ffb6c1 100%)',
            'blue': 'linear-gradient(135deg, #e3f2fd 0%, #90caf9 100%)',
            'green': 'linear-gradient(135deg, #e8f5e9 0%, #a5d6a7 100%)'
        };

        function selectWallpaper(wallpaperKey) {
            appData.settings.wallpaper = wallpaperKey;
            document.querySelectorAll('.wallpaper-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.wallpaper === wallpaperKey);
            });
        }

        // 壁纸上传（自动压缩）
        async function handleWallpaperUpload(input) {
            const file = input.files[0];
            if (!file) return;

            const base64 = await compressImage(file, 500, 800);
            appData.settings.customWallpaper = base64;
            appData.settings.wallpaper = 'custom';
            const previewEl = document.getElementById('customWallpaperPreview');
            previewEl.style.backgroundImage = `url(${base64})`;
            previewEl.innerHTML = '<span class="custom-delete-btn" onclick="event.stopPropagation(); clearCustomWallpaper()">×</span>';
            document.getElementById('customWallpaperOption').classList.add('has-custom');
            document.querySelectorAll('.wallpaper-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.wallpaper === 'custom');
            });
        }

        function clearCustomWallpaper() {
            appData.settings.customWallpaper = null;
            appData.settings.wallpaper = 'default';
            const previewEl = document.getElementById('customWallpaperPreview');
            previewEl.style.backgroundImage = '';
            previewEl.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span class="custom-delete-btn" onclick="event.stopPropagation(); clearCustomWallpaper()">×</span>';
            document.getElementById('customWallpaperOption').classList.remove('has-custom');
            document.querySelectorAll('.wallpaper-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.wallpaper === 'default');
            });
            saveData();
            applyWallpaper();
        }

        function applyWallpaper() {
            const wallpaper = appData.settings.wallpaper || 'default';
            const container = document.querySelector('.phone-container');
            if (!container) return;
            if (wallpaper === 'custom' && appData.settings.customWallpaper) {
                container.style.background = `url(${appData.settings.customWallpaper}) center/cover no-repeat`;
            } else {
                container.style.background = wallpaperStyles[wallpaper] || wallpaperStyles['default'];
            }
        }

        // 助手头像上传处理（自动压缩）
        async function handleAssistantAvatarUpload(input) {
            const file = input.files[0];
            if (!file) return;

            const base64 = await compressImage(file, 200, 200);
            document.getElementById('editAssistantAvatar').value = base64;
            const previewEl = document.getElementById('assistantAvatarPreview');
            previewEl.innerHTML = `<img src="${base64}" alt="">`;
            previewEl.classList.add('has-image');
        }

        function clearAssistantAvatar() {
            document.getElementById('editAssistantAvatar').value = '';
            const previewEl = document.getElementById('assistantAvatarPreview');
            previewEl.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
            previewEl.classList.remove('has-image');
        }

        // 初始化时应用显示设置
        function initDisplaySettings() {
            const fontKey = appData.settings.chatFont || 'system';
            applyFont(fontKey);
            applyFontSize(appData.settings.chatFontSize || 15);
            applyWallpaper();
            applyWechatTheme();
            applyBubbleOpacity();
        }

        function updateSettingsCounts() {
            document.getElementById('providerCount').textContent = appData.providers.length + '个';
            document.getElementById('assistantCount').textContent = appData.assistants.length + '个';
        }
