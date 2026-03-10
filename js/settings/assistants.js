/**
 * 助手管理模块
 *
 * 负责：助手列表渲染、创建/编辑/删除、模型选择器、助手记忆管理
 * 暴露函数：renderAssistantList, createNewAssistant, editAssistant, renderAssistantEditForm,
 *           switchAssistantTab, renderAssistantModelSelector, selectAssistantModel,
 *           clearAssistantModel, saveAssistant, deleteAssistant,
 *           openAssistantMemoryPanel, renderMemoryPanelList, addMemoryItemToPanel,
 *           autoSaveAssistantMemory, closeAssistantMemory
 * 暴露变量：editingMemoryAssistantId
 * 依赖：appData/editingAssistantId (data.js), saveData (storage.js),
 *        openPage/closePage (navigation.js), getModelGroup (models.js),
 *        closeSidebarInstantly (主文件)
 */

        function renderAssistantList() {
            const container = document.getElementById('assistantList');
            if (appData.assistants.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🤖</div>
                        <div class="empty-state-text">还没有创建助手<br>点击右上角 + 创建</div>
                    </div>
                `;
                return;
            }

            container.innerHTML = appData.assistants.map(a => {
                return `
                    <div class="assistant-card ${a.id === appData.currentAssistantId ? 'active' : ''}" onclick="editAssistant('${a.id}')">
                        <div class="assistant-avatar">
                            ${a.avatar ? `<img src="${a.avatar}" alt="">` : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}
                        </div>
                        <div class="assistant-info">
                            <div class="assistant-name">${a.name}</div>
                            <div class="assistant-desc">${a.systemPrompt ? a.systemPrompt.substring(0, 30) + '...' : '暂无提示词'}</div>
                        </div>
                        ${a.id === appData.currentAssistantId ? '<span class="assistant-badge">当前</span>' : ''}
                    </div>
                `;
            }).join('');
        }

        function createNewAssistant() {
            editingAssistantId = null;
            document.getElementById('assistantEditTitle').textContent = '创建助手';
            renderAssistantEditForm({
                name: '',
                avatar: '',
                systemPrompt: '',
                temperature: 1,
                maxTokens: 0,
                providerId: '',
                modelId: ''
            });
            openPage('assistantEditPage');
        }

        function editAssistant(id) {
            editingAssistantId = id;
            const assistant = appData.assistants.find(a => a.id === id);
            document.getElementById('assistantEditTitle').textContent = assistant.name;
            renderAssistantEditForm(assistant);
            openPage('assistantEditPage');
        }

        function renderAssistantEditForm(data) {
            const html = `
                <div class="tabs">
                    <button class="tab active" onclick="switchAssistantTab(this, 'basic')">基础设置</button>
                    <button class="tab" onclick="switchAssistantTab(this, 'prompt')">提示词</button>
                    <button class="tab" onclick="switchAssistantTab(this, 'model')">模型</button>
                </div>

                <div id="assistantTabBasic">
                    <div class="form-section">
                        <div class="form-group">
                            <div class="avatar-name-row">
                                <div class="assistant-avatar-upload" onclick="document.getElementById('assistantAvatarInput').click()">
                                    <div class="assistant-avatar-preview ${data.avatar ? 'has-image' : ''}" id="assistantAvatarPreview">
                                        ${data.avatar ? `<img src="${data.avatar}" alt="">` : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}
                                    </div>
                                    <span class="assistant-avatar-delete" onclick="event.stopPropagation(); clearAssistantAvatar()">×</span>
                                </div>
                                <div style="flex: 1;">
                                    <label class="form-label">助手名称</label>
                                    <input type="text" class="form-input" id="editAssistantName" value="${data.name || ''}" placeholder="给助手起个名字">
                                </div>
                            </div>
                            <input type="file" id="assistantAvatarInput" accept="image/*" style="display:none" onchange="handleAssistantAvatarUpload(this)">
                            <input type="hidden" id="editAssistantAvatar" value="${data.avatar || ''}">
                        </div>
                    </div>

                    <div class="form-section">
                        <div class="form-section-title">参数设置</div>
                        <div class="form-group">
                            <label class="form-label">Temperature</label>
                            <div class="slider-container">
                                <input type="range" class="slider" id="editAssistantTemp" min="0" max="2" step="0.05" value="${data.temperature || 1}" oninput="document.getElementById('tempValue').textContent=this.value">
                                <span class="slider-value" id="tempValue">${data.temperature || 1}</span>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">最大 Token 数 (0为无限制)</label>
                            <input type="number" class="form-input" id="editAssistantMaxTokens" value="${data.maxTokens || 0}" min="0">
                        </div>
                    </div>
                    <div class="form-section">
                        <div class="form-section-title">向量记忆</div>
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <div style="font-size:14px;color:var(--text-primary);">自动同步向量记忆</div>
                                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">开启后自动提取聊天中的叙事元并同步到向量记忆库</div>
                            </div>
                            <div class="switch ${data.vectorMemoryEnabled ? 'on' : ''}" id="editVectorMemory" onclick="this.classList.toggle('on')"></div>
                        </div>
                    </div>
                </div>

                <div id="assistantTabPrompt" style="display: none;">
                    <div class="form-section">
                        <div class="form-group">
                            <label class="form-label">系统提示词</label>
                            <textarea class="form-textarea" id="editAssistantPrompt" rows="15" placeholder="设定助手的人格和行为...">${data.systemPrompt || ''}</textarea>
                        </div>
                    </div>
                </div>

                <div id="assistantTabModel" style="display: none;">
                    <div class="form-section">
                        <div class="form-section-title">
                            <span>聊天模型</span>
                            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px; margin-left: auto;" onclick="clearAssistantModel()">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                                重置
                            </button>
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
                            为该助手设置专用模型（未设置时使用全局默认）
                        </div>
                        <input type="hidden" id="editAssistantProviderId" value="${data.providerId || ''}">
                        <input type="hidden" id="editAssistantModelId" value="${data.modelId || ''}">
                        <div id="assistantModelSelector">
                            ${renderAssistantModelSelector(data.providerId, data.modelId)}
                        </div>
                    </div>
                </div>

                ${editingAssistantId ? `
                    <div style="padding: 16px 0;">
                        <button class="btn btn-block" style="background: #fee; color: #d32f2f;" onclick="deleteAssistant('${editingAssistantId}')">删除助手</button>
                    </div>
                ` : ''}
            `;
            document.getElementById('assistantEditContent').innerHTML = html;
        }

        function switchAssistantTab(btn, tab) {
            document.querySelectorAll('#assistantEditContent .tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('assistantTabBasic').style.display = tab === 'basic' ? 'block' : 'none';
            document.getElementById('assistantTabPrompt').style.display = tab === 'prompt' ? 'block' : 'none';
            document.getElementById('assistantTabModel').style.display = tab === 'model' ? 'block' : 'none';
        }

        // 渲染助手模型选择器
        function renderAssistantModelSelector(selectedProviderId, selectedModelId) {
            const allModels = [];
            appData.providers.forEach(p => {
                (p.models || []).forEach(m => {
                    allModels.push({ ...m, providerId: p.id, providerName: p.name });
                });
            });

            if (allModels.length === 0) {
                return `<div class="empty-state" style="padding: 20px;"><div class="empty-state-text">请先在设置中添加供应商和模型</div></div>`;
            }

            // 按厂商分组
            const groups = {};
            allModels.forEach(m => {
                const groupName = getModelGroup(m.id);
                if (!groups[groupName]) {
                    groups[groupName] = [];
                }
                groups[groupName].push(m);
            });

            // 排序分组
            const groupOrder = [
                'Claude Opus', 'Claude Sonnet', 'Claude Haiku', 'Claude 3.5', 'Claude 3', 'Claude',
                'GPT-4o', 'GPT-4 Turbo', 'GPT-4', 'GPT-3.5', 'OpenAI o系列', 'OpenAI',
                'Gemini 2', 'Gemini 1.5', 'Gemini 1', 'Google Gemini',
                'DeepSeek', 'Qwen 通义', 'xAI Grok',
                'Llama 3.3', 'Llama 3.2', 'Llama 3.1', 'Llama 3', 'Meta Llama',
                'Mistral', 'Cohere'
            ];

            const sortedGroups = Object.keys(groups).sort((a, b) => {
                const aIdx = groupOrder.indexOf(a);
                const bIdx = groupOrder.indexOf(b);
                if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
                if (aIdx === -1) return 1;
                if (bIdx === -1) return -1;
                return aIdx - bIdx;
            });

            let html = `<div class="model-list" style="max-height: 350px;">`;

            // 当前选中的模型显示
            if (selectedProviderId && selectedModelId) {
                const selectedModel = allModels.find(m => m.providerId === selectedProviderId && m.id === selectedModelId);
                if (selectedModel) {
                    html += `
                        <div style="padding: 12px; background: var(--accent-light); border-radius: 8px; margin-bottom: 12px;">
                            <div style="font-size: 12px; color: var(--accent-dark); margin-bottom: 4px;">当前选择</div>
                            <div style="font-weight: 500;">${selectedModel.name || selectedModel.id}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">${selectedModel.providerName}</div>
                        </div>
                    `;
                }
            } else {
                html += `
                    <div style="padding: 12px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 12px;">
                        <div style="font-size: 12px; color: var(--text-muted);">当前选择</div>
                        <div style="color: var(--text-muted);">使用全局默认模型</div>
                    </div>
                `;
            }

            sortedGroups.forEach(groupName => {
                const groupModels = groups[groupName];
                html += `
                    <div class="model-group" data-group="${groupName}">
                        <div class="model-group-header" onclick="toggleModelGroup(this)">
                            <svg class="model-group-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                            <span class="model-group-name">${groupName}</span>
                            <span class="model-group-count">${groupModels.length}</span>
                        </div>
                        <div class="model-group-content">
                            ${groupModels.map(m => `
                                <div class="model-item ${m.providerId === selectedProviderId && m.id === selectedModelId ? 'selected' : ''}"
                                     onclick="selectAssistantModel('${m.providerId}', '${m.id}', '${(m.name || m.id).replace(/'/g, "\\'")}')">
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

            html += `</div>`;
            return html;
        }

        // 选择助手模型
        function selectAssistantModel(providerId, modelId, modelName) {
            document.getElementById('editAssistantProviderId').value = providerId;
            document.getElementById('editAssistantModelId').value = modelId;
            // 刷新选择器显示
            document.getElementById('assistantModelSelector').innerHTML = renderAssistantModelSelector(providerId, modelId);
        }

        // 清除助手模型设置（使用全局默认）
        function clearAssistantModel() {
            document.getElementById('editAssistantProviderId').value = '';
            document.getElementById('editAssistantModelId').value = '';
            document.getElementById('assistantModelSelector').innerHTML = renderAssistantModelSelector('', '');
        }

        function saveAssistant() {
            const name = document.getElementById('editAssistantName').value.trim();
            const avatar = document.getElementById('editAssistantAvatar').value;
            const prompt = document.getElementById('editAssistantPrompt').value;
            const temp = parseFloat(document.getElementById('editAssistantTemp').value);
            const maxTokens = parseInt(document.getElementById('editAssistantMaxTokens').value);

            if (!name) {
                alert('请输入助手名称');
                return;
            }

            // 从表单读取模型设置
            const providerId = document.getElementById('editAssistantProviderId').value;
            const modelId = document.getElementById('editAssistantModelId').value;

            const vectorMemoryEnabled = document.getElementById('editVectorMemory')?.classList.contains('on') || false;

            const assistantData = {
                id: editingAssistantId || 'assistant_' + Date.now(),
                name,
                avatar,
                providerId: providerId || '',
                modelId: modelId || '',
                systemPrompt: prompt,
                temperature: temp,
                maxTokens,
                vectorMemoryEnabled
            };

            if (editingAssistantId) {
                const index = appData.assistants.findIndex(a => a.id === editingAssistantId);
                if (index !== -1) {
                    appData.assistants[index] = { ...appData.assistants[index], ...assistantData };
                }
            } else {
                appData.assistants.push(assistantData);
                if (appData.assistants.length === 1) {
                    appData.currentAssistantId = assistantData.id;
                }
            }

            saveData();
            closePage('assistantEditPage');
            renderAssistantList();
        }

        function deleteAssistant(id) {
            if (!confirm('确定要删除这个助手吗？')) return;
            appData.assistants = appData.assistants.filter(a => a.id !== id);
            if (appData.currentAssistantId === id) {
                appData.currentAssistantId = appData.assistants[0]?.id || null;
            }
            saveData();
            closePage('assistantEditPage');
            renderAssistantList();
        }

        // ==================== 助手记忆管理 ====================
        let editingMemoryAssistantId = null;

        function openAssistantMemoryPanel(id) {
            editingMemoryAssistantId = id;
            const assistant = appData.assistants.find(a => a.id === id);
            if (!assistant) return;

            // 关掉侧边栏再打开记忆页
            closeSidebarInstantly();

            document.getElementById('assistantMemoryTitle').textContent = assistant.name + ' - 记忆';

            const sw = document.getElementById('memoryPanelEnabled');
            if (assistant.memoryEnabled) {
                sw.classList.add('on');
            } else {
                sw.classList.remove('on');
            }

            renderMemoryPanelList(assistant.memories || []);
            openPage('assistantMemoryPage');
        }

        function renderMemoryPanelList(memories) {
            const container = document.getElementById('memoryPanelList');
            if (memories.length === 0) {
                container.innerHTML = '<div class="empty-state" style="padding: 20px;"><div class="empty-state-text">暂无记忆</div></div>';
                return;
            }
            container.innerHTML = memories.map((m, i) => `
                <div class="provider-card" style="margin-bottom: 8px; padding: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <textarea class="form-textarea memory-panel-item" style="min-height: 60px; font-size: 13px;" placeholder="记忆内容..." onchange="autoSaveAssistantMemory()">${m}</textarea>
                        <button class="btn-icon danger" style="flex-shrink: 0; margin-left: 8px;" onclick="this.parentElement.parentElement.remove(); autoSaveAssistantMemory()">×</button>
                    </div>
                </div>
            `).join('');
        }

        function addMemoryItemToPanel() {
            const list = document.getElementById('memoryPanelList');
            const emptyState = list.querySelector('.empty-state');
            if (emptyState) emptyState.remove();

            const item = document.createElement('div');
            item.className = 'provider-card';
            item.style.cssText = 'margin-bottom: 8px; padding: 12px;';
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <textarea class="form-textarea memory-panel-item" style="min-height: 60px; font-size: 13px;" placeholder="记忆内容..." onchange="autoSaveAssistantMemory()"></textarea>
                    <button class="btn-icon danger" style="flex-shrink: 0; margin-left: 8px;" onclick="this.parentElement.parentElement.remove(); autoSaveAssistantMemory()">×</button>
                </div>
            `;
            list.appendChild(item);
        }

        function autoSaveAssistantMemory() {
            if (!editingMemoryAssistantId) return;
            const index = appData.assistants.findIndex(a => a.id === editingMemoryAssistantId);
            if (index === -1) return;

            const memoryEnabled = document.getElementById('memoryPanelEnabled').classList.contains('on');
            const memories = Array.from(document.querySelectorAll('.memory-panel-item')).map(t => t.value.trim()).filter(v => v);

            appData.assistants[index].memoryEnabled = memoryEnabled;
            appData.assistants[index].memories = memories;
            saveData();
        }

        function closeAssistantMemory() {
            autoSaveAssistantMemory();
            closePage('assistantMemoryPage');
        }
