/**
 * 深度思考设置模块
 *
 * 负责：思考级别选择和显示
 * 暴露函数：showThinkingModal, hideThinkingModal, updateThinkingOptions,
 *           selectThinkingLevel, updateThinkingDisplay
 * 依赖：appData/thinkingConfig (data.js), saveData (storage.js)
 */

        function showThinkingModal() {
            document.getElementById('thinkingModal').classList.add('show');
            document.getElementById('thinkingOverlay').classList.add('show');
            updateThinkingOptions();
        }

        function hideThinkingModal() {
            document.getElementById('thinkingModal').classList.remove('show');
            document.getElementById('thinkingOverlay').classList.remove('show');
        }

        function updateThinkingOptions() {
            const level = appData.settings.thinkingLevel || 'medium';
            document.querySelectorAll('.thinking-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.level === level);
            });
        }

        function selectThinkingLevel(level) {
            appData.settings.thinkingLevel = level;
            saveData();
            updateThinkingDisplay();
            hideThinkingModal();
        }

        function updateThinkingDisplay() {
            const level = appData.settings.thinkingLevel || 'medium';
            const config = thinkingConfig[level];
            document.getElementById('thinkingLevelDisplay').textContent = config.label;
            updateThinkingOptions();
        }
