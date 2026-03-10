/**
 * 供应商管理模块
 *
 * 负责：供应商列表渲染、添加、删除
 * 暴露函数：renderProviderList, showAddProviderModal, addProvider, deleteProvider
 * 依赖：appData (data.js), saveData (storage.js), showModal/hideModal (ui.js)
 */

        function renderProviderList() {
            const container = document.getElementById('providerList');
            if (appData.providers.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📡</div>
                        <div class="empty-state-text">还没有添加供应商<br>点击右上角 + 添加</div>
                    </div>
                `;
                return;
            }

            container.innerHTML = appData.providers.map(p => `
                <div class="provider-card">
                    <div class="provider-header">
                        <span class="provider-name">${p.name}</span>
                        <div style="display: flex; gap: 4px;">
                            <button class="btn-icon" onclick="manageProviderModels('${p.id}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v10"/></svg>
                            </button>
                            <button class="btn-icon danger" onclick="deleteProvider('${p.id}')">
                                <span class="icon-delete"></span>
                            </button>
                        </div>
                    </div>
                    <div class="provider-url">${p.baseUrl}</div>
                    <div class="provider-meta">
                        <span class="provider-model-count" onclick="manageProviderModels('${p.id}')">
                            已添加 ${(p.models || []).length} 个模型
                        </span>
                        <span class="provider-status enabled">启用</span>
                    </div>
                </div>
            `).join('');
        }

        function showAddProviderModal() {
            document.getElementById('newProviderName').value = '';
            document.getElementById('newProviderKey').value = '';
            document.getElementById('newProviderUrl').value = '';
            document.getElementById('newProviderPath').value = '/chat/completions';
            showModal('addProviderModal');
        }

        function addProvider() {
            const name = document.getElementById('newProviderName').value.trim();
            const key = document.getElementById('newProviderKey').value.trim();
            const url = document.getElementById('newProviderUrl').value.trim();
            const path = document.getElementById('newProviderPath').value.trim() || '/chat/completions';

            if (!name || !key || !url) {
                alert('请填写完整信息');
                return;
            }

            const provider = {
                id: 'provider_' + Date.now(),
                name,
                apiKey: key,
                baseUrl: url.replace(/\/$/, ''),
                apiPath: path,
                enabled: true,
                models: []
            };

            appData.providers.push(provider);
            saveData();
            hideModal('addProviderModal');
            renderProviderList();
        }

        function deleteProvider(id) {
            if (!confirm('确定要删除这个供应商吗？')) return;
            appData.providers = appData.providers.filter(p => p.id !== id);
            appData.assistants = appData.assistants.filter(a => a.providerId !== id);
            saveData();
            renderProviderList();
        }
