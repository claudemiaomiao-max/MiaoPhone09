/**
 * 初始化入口
 *
 * 负责：init()、setupTextareaAutoResize()、saveGlobalSecondaryModel()、
 *        openMiaomiaoAPI()、closeSidebarInstantly()、exitToDesktop()
 * 暴露函数：init, setupTextareaAutoResize, saveGlobalSecondaryModel,
 *           openMiaomiaoAPI, closeSidebarInstantly, exitToDesktop
 * 依赖：initIndexedDB/migrateFromLocalStorage/loadData/saveData/dbInstance(storage.js),
 *        updateSettingsCounts/initDisplaySettings(display.js),
 *        updateThinkingDisplay(thinking.js), updateTtsStatus(tts.js),
 *        loadMlabConfig(memory-lab.js), sendMessage/isSending(api-send.js),
 *        updateChatHeader/renderSidebarAssistants/renderConversationList/renderMessages(api-chat.js),
 *        openPage/closePage(navigation.js)
 */

        // ==================== 初始化 ====================
        async function init() {
            // 初始化 IndexedDB
            await initIndexedDB();

            // 迁移旧数据（从 localStorage 到 IndexedDB）
            if (dbInstance) {
                await migrateFromLocalStorage();
            }

            // 加载数据
            await loadData();

            updateSettingsCounts();
            setupTextareaAutoResize();
            updateThinkingDisplay();
            updateTtsStatus();
            initDisplaySettings();
            loadMlabConfig(); // 加载Memory Lab配置（含检索参数），确保聊天时可用
        }

        function setupTextareaAutoResize() {
            const textarea = document.getElementById('chatInput');
            textarea.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 120) + 'px';
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
                            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
                            e.preventDefault();
                        } else {
                            // Enter：发送消息（检查是否正在发送中）
                            e.preventDefault();
                            if (!isSending) sendMessage();
                        }
                    }
                }
            });
        }

        // 保存副模型
        function saveGlobalSecondaryModel() {
            const select = document.getElementById('globalSecondaryModel');
            appData.settings.secondaryModel = select.value;
            saveData();
        }

        function openMiaomiaoAPI() {
            openPage('chatPage');
            updateChatHeader();
            renderSidebarAssistants();
            renderConversationList();
            if (appData.currentConversationId) {
                renderMessages();
            }
        }

        // 瞬间关闭侧边栏（跳过动画）
        function closeSidebarInstantly() {
            const sidebar = document.getElementById('chatSidebar');
            const backdrop = document.getElementById('sidebarBackdrop');
            if (!sidebar.classList.contains('open')) return;
            sidebar.style.transition = 'none';
            backdrop.style.transition = 'none';
            sidebar.classList.remove('open');
            backdrop.classList.remove('show');
            // 强制回流后恢复 transition
            sidebar.offsetHeight;
            sidebar.style.transition = '';
            backdrop.style.transition = '';
        }

        function exitToDesktop() {
            // 彻底隐藏侧边栏和遮罩，防止右滑时露出
            const sidebar = document.getElementById('chatSidebar');
            const backdrop = document.getElementById('sidebarBackdrop');
            sidebar.style.transition = 'none';
            backdrop.style.transition = 'none';
            sidebar.classList.remove('open');
            backdrop.classList.remove('show');
            sidebar.style.display = 'none';
            backdrop.style.display = 'none';

            closePage('chatPage');

            // 页面关闭动画结束后恢复侧边栏状态
            setTimeout(() => {
                sidebar.style.transition = '';
                backdrop.style.transition = '';
                sidebar.style.display = '';
                backdrop.style.display = '';
            }, 350);
        }

        // 初始化
        init();
