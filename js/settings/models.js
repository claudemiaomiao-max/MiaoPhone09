/**
 * 模型管理模块
 *
 * 负责：模型列表获取、分组渲染、搜索过滤、勾选保存
 * 暴露函数：manageProviderModels, fetchModels, renderModelList, getModelGroup,
 *           renderGroupedModels, filterModels, toggleModelGroup, selectAllInGroup,
 *           toggleModelSelection, saveSelectedModels
 * 暴露变量：allMergedModels, modelSavedIds
 * 依赖：appData/currentManagingProviderId/fetchedModels (data.js),
 *        saveData (storage.js), showModal/hideModal (ui.js)
 */

        function manageProviderModels(providerId) {
            currentManagingProviderId = providerId;
            const provider = appData.providers.find(p => p.id === providerId);
            document.getElementById('modelManageTitle').textContent = provider.name + ' - 模型管理';
            fetchedModels = [];
            renderModelList(provider.models || [], []);
            showModal('modelManageModal');
        }

        async function fetchModels() {
            const provider = appData.providers.find(p => p.id === currentManagingProviderId);
            if (!provider) return;

            document.getElementById('modelListContent').innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <div class="typing-indicator" style="justify-content: center;">
                        <span></span><span></span><span></span>
                    </div>
                    <p style="margin-top: 12px; color: var(--text-muted);">正在获取模型列表...</p>
                </div>
            `;

            try {
                const response = await fetch(provider.baseUrl + '/models', {
                    method: 'GET',
                    headers: { 'Authorization': 'Bearer ' + provider.apiKey }
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                fetchedModels = data.data || data.models || [];
                renderModelList(provider.models || [], fetchedModels);
            } catch (error) {
                document.getElementById('modelListContent').innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #d32f2f;">
                        获取失败: ${error.message}
                    </div>
                `;
            }
        }

        // 全局存储合并后的模型列表，供搜索使用
        let allMergedModels = [];
        let modelSavedIds = [];

        function renderModelList(savedModels, allModels) {
            modelSavedIds = savedModels.map(m => m.id);
            allMergedModels = [...savedModels];

            allModels.forEach(m => {
                if (!modelSavedIds.includes(m.id)) {
                    allMergedModels.push(m);
                }
            });

            if (allMergedModels.length === 0) {
                document.getElementById('modelListContent').innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-text">点击"获取模型"拉取可用模型</div>
                    </div>
                `;
                return;
            }

            renderGroupedModels(allMergedModels, '');
        }

        // 根据模型ID获取分组名称
        function getModelGroup(modelId) {
            const id = modelId.toLowerCase();

            // 提取厂商前缀
            const provider = id.split('/')[0] || '';
            const modelName = id.split('/')[1] || id;

            // Claude系列细分
            if (provider === 'anthropic' || id.includes('claude')) {
                if (id.includes('opus')) return 'Claude Opus';
                if (id.includes('sonnet')) return 'Claude Sonnet';
                if (id.includes('haiku')) return 'Claude Haiku';
                if (id.includes('3.5') || id.includes('3-5')) return 'Claude 3.5';
                if (id.includes('claude-3') || id.includes('claude3')) return 'Claude 3';
                return 'Claude';
            }

            // OpenAI系列细分
            if (provider === 'openai' || id.includes('gpt')) {
                if (id.includes('gpt-4o') || id.includes('chatgpt-4o')) return 'GPT-4o';
                if (id.includes('gpt-4-turbo')) return 'GPT-4 Turbo';
                if (id.includes('gpt-4')) return 'GPT-4';
                if (id.includes('gpt-3.5')) return 'GPT-3.5';
                if (id.includes('o1') || id.includes('o3')) return 'OpenAI o系列';
                return 'OpenAI';
            }

            // Google系列
            if (provider === 'google' || id.includes('gemini')) {
                if (id.includes('gemini-2')) return 'Gemini 2';
                if (id.includes('gemini-1.5') || id.includes('gemini-pro')) return 'Gemini 1.5';
                if (id.includes('gemini-1') || id.includes('gemini-ultra')) return 'Gemini 1';
                return 'Google Gemini';
            }

            // DeepSeek
            if (provider === 'deepseek' || id.includes('deepseek')) {
                return 'DeepSeek';
            }

            // Meta Llama
            if (provider === 'meta-llama' || provider === 'meta' || id.includes('llama')) {
                if (id.includes('llama-3.3')) return 'Llama 3.3';
                if (id.includes('llama-3.2')) return 'Llama 3.2';
                if (id.includes('llama-3.1')) return 'Llama 3.1';
                if (id.includes('llama-3')) return 'Llama 3';
                return 'Meta Llama';
            }

            // Mistral
            if (provider === 'mistralai' || id.includes('mistral') || id.includes('mixtral')) {
                return 'Mistral';
            }

            // Qwen
            if (provider === 'qwen' || id.includes('qwen')) {
                return 'Qwen 通义';
            }

            // Cohere
            if (provider === 'cohere' || id.includes('command')) {
                return 'Cohere';
            }

            // xAI Grok
            if (provider === 'x-ai' || id.includes('grok')) {
                return 'xAI Grok';
            }

            // 其他按厂商分组
            if (provider) {
                return provider.charAt(0).toUpperCase() + provider.slice(1);
            }

            return '其他';
        }

        // 渲染分组模型列表
        function renderGroupedModels(models, searchKeyword) {
            const keyword = searchKeyword.toLowerCase().trim();

            // 过滤模型
            const filteredModels = keyword
                ? models.filter(m => {
                    const name = (m.name || '').toLowerCase();
                    const id = (m.id || '').toLowerCase();
                    return name.includes(keyword) || id.includes(keyword);
                })
                : models;

            if (filteredModels.length === 0) {
                document.getElementById('modelListContent').innerHTML = `
                    <div class="model-search-box">
                        <input type="text" class="model-search-input" placeholder="输入模型名称筛选..."
                               value="${searchKeyword}" oninput="filterModels(this.value)">
                    </div>
                    <div class="empty-state" style="padding: 40px;">
                        <div class="empty-state-text">没有找到匹配的模型</div>
                    </div>
                `;
                return;
            }

            // 按分组整理模型
            const groups = {};
            filteredModels.forEach(m => {
                const groupName = getModelGroup(m.id);
                if (!groups[groupName]) {
                    groups[groupName] = [];
                }
                groups[groupName].push(m);
            });

            // 分组排序（常用的放前面）
            const groupOrder = [
                'Claude Opus', 'Claude Sonnet', 'Claude Haiku', 'Claude 3.5', 'Claude 3', 'Claude',
                'GPT-4o', 'GPT-4 Turbo', 'GPT-4', 'GPT-3.5', 'OpenAI o系列', 'OpenAI',
                'Gemini 2', 'Gemini 1.5', 'Gemini 1', 'Google Gemini',
                'DeepSeek',
                'Qwen 通义',
                'xAI Grok',
                'Llama 3.3', 'Llama 3.2', 'Llama 3.1', 'Llama 3', 'Meta Llama',
                'Mistral',
                'Cohere'
            ];

            const sortedGroups = Object.keys(groups).sort((a, b) => {
                const aIdx = groupOrder.indexOf(a);
                const bIdx = groupOrder.indexOf(b);
                if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
                if (aIdx === -1) return 1;
                if (bIdx === -1) return -1;
                return aIdx - bIdx;
            });

            // 渲染HTML
            let html = `
                <div class="model-search-box">
                    <input type="text" class="model-search-input" placeholder="输入模型名称筛选..."
                           value="${searchKeyword}" oninput="filterModels(this.value)">
                </div>
            `;

            sortedGroups.forEach(groupName => {
                const groupModels = groups[groupName];
                const selectedCount = groupModels.filter(m => modelSavedIds.includes(m.id)).length;

                html += `
                    <div class="model-group" data-group="${groupName}">
                        <div class="model-group-header" onclick="toggleModelGroup(this)">
                            <svg class="model-group-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                            <span class="model-group-name">${groupName}</span>
                            <span class="model-group-count">${selectedCount > 0 ? selectedCount + '/' : ''}${groupModels.length}</span>
                            <button class="model-group-add-all" onclick="event.stopPropagation(); selectAllInGroup('${groupName}')">全选</button>
                        </div>
                        <div class="model-group-content">
                            ${groupModels.map(m => `
                                <div class="model-item ${modelSavedIds.includes(m.id) ? 'selected' : ''}"
                                     data-model-id="${m.id}" onclick="toggleModelSelection(this)">
                                    <div class="model-item-checkbox"></div>
                                    <div class="model-item-info">
                                        <div class="model-item-name">${m.name || m.id}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            });

            document.getElementById('modelListContent').innerHTML = html;
        }

        // 搜索过滤模型
        function filterModels(keyword) {
            renderGroupedModels(allMergedModels, keyword);
        }

        // 展开/折叠分组
        function toggleModelGroup(headerEl) {
            headerEl.parentElement.classList.toggle('collapsed');
        }

        // 全选分组内的模型
        function selectAllInGroup(groupName) {
            const groupEl = document.querySelector(`.model-group[data-group="${groupName}"]`);
            if (!groupEl) return;

            const items = groupEl.querySelectorAll('.model-item');
            const allSelected = Array.from(items).every(el => el.classList.contains('selected'));

            items.forEach(el => {
                if (allSelected) {
                    el.classList.remove('selected');
                } else {
                    el.classList.add('selected');
                }
            });
        }

        function toggleModelSelection(el) {
            el.classList.toggle('selected');
        }

        function saveSelectedModels() {
            const provider = appData.providers.find(p => p.id === currentManagingProviderId);
            if (!provider) return;

            const selectedItems = document.querySelectorAll('#modelListContent .model-item.selected');
            provider.models = Array.from(selectedItems).map(el => {
                const id = el.dataset.modelId;  // 从 data-model-id 读取真实模型ID
                const name = el.querySelector('.model-item-name').textContent;
                return { id, name };
            });

            saveData();
            hideModal('modelManageModal');
            renderProviderList();
            alert(`已保存 ${provider.models.length} 个模型`);
        }
