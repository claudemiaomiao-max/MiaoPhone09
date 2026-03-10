/**
 * 微信模式 - 长期记忆
 *
 * 负责：长期记忆列表管理、手动/自动摘要生成、记忆导出/编辑/删除
 * 暴露函数：checkAutoSummary, triggerManualSummary, exportLongTermMemory,
 *           memoryEditingIndex
 * 依赖：appData(data.js), wechatData/saveWechatData/renderWechatMessages(wechat-core.js),
 *        showWechatToast/downloadFile/escapeHtml(ui.js), openPage/closePage(navigation.js)
 */

        // ==================== 长期记忆功能 ====================

        function exportLongTermMemory() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const memories = conv?.settings?.longTermMemory || [];
            if (memories.length === 0) { alert('暂无记忆可导出'); return; }

            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            const name = assistant?.name || '助手';

            // 按时间正序
            const sorted = [...memories].sort((a, b) => new Date(a.time) - new Date(b.time));

            let md = `# ${name} - 长期记忆\n\n`;
            md += `> 导出时间：${new Date().toLocaleString('zh-CN')}  \n`;
            md += `> 共 ${sorted.length} 条记忆\n\n---\n\n`;

            let lastDate = '';
            for (const mem of sorted) {
                const dt = new Date(mem.time);
                const date = dt.toLocaleDateString('zh-CN');
                if (date !== lastDate) { md += `## ${date}\n\n`; lastDate = date; }
                const time = dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                const source = mem.type === 'user' ? '用户添加' : (mem.auto ? '自动总结' : 'AI总结');
                md += `- **[${time} · ${source}]** ${mem.content}\n`;
            }

            downloadFile(md, `记忆_${name}_${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
        }

        // 打开长期记忆页面
        function openWechatMemoryPage() {
            renderWechatMemoryList();
            openPage('wechatMemoryPage');
        }

        // 记忆编辑状态
        let memoryEditingIndex = -1; // -1表示添加新记忆，>=0表示编辑已有记忆

        // 渲染记忆列表
        function renderWechatMemoryList() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const memories = conv?.settings?.longTermMemory || [];
            const container = document.getElementById('wechatMemoryList');

            if (memories.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: #999;">
                        <div style="font-size: 48px; margin-bottom: 12px;">🧠</div>
                        <div>暂无记忆</div>
                        <div style="font-size: 12px; margin-top: 8px;">点击上方按钮让AI总结，或手动添加记忆</div>
                    </div>
                `;
                return;
            }

            // 按时间倒序显示（最新的在上面）
            const sortedMemories = [...memories].sort((a, b) => new Date(b.time) - new Date(a.time));

            container.innerHTML = sortedMemories.map((mem, idx) => {
                const realIdx = memories.indexOf(mem);
                const time = new Date(mem.time);
                const timeStr = `${time.getFullYear()}/${(time.getMonth()+1).toString().padStart(2,'0')}/${time.getDate().toString().padStart(2,'0')} ${time.getHours().toString().padStart(2,'0')}:${time.getMinutes().toString().padStart(2,'0')}`;
                const typeLabel = mem.type === 'user' ? '📝 用户添加' : (mem.auto ? '🤖 自动总结' : '🤖 AI总结');
                const typeColor = mem.type === 'user' ? '#576b95' : '#07c160';

                return `
                    <div class="memory-item" style="background: #fff; border-radius: 8px; padding: 12px; margin-bottom: 8px; position: relative;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 12px; color: ${typeColor}; font-weight: 500;">${typeLabel}</span>
                            <span style="font-size: 11px; color: #999;">${timeStr}</span>
                        </div>
                        <div style="font-size: 14px; color: #333; line-height: 1.5; white-space: pre-wrap; padding-bottom: 20px;">${escapeHtml(mem.content)}</div>
                        <div class="memory-actions" style="position: absolute; bottom: 8px; right: 8px; display: none; gap: 4px;">
                            <button onclick="openEditMemoryModal(${realIdx})" style="width: 24px; height: 24px; border: none; background: none; color: #576b95; cursor: pointer; font-size: 14px;" title="编辑">✎</button>
                            <button onclick="deleteMemory(${realIdx})" style="width: 24px; height: 24px; border: none; background: none; color: #fa5151; cursor: pointer; font-size: 16px;" title="删除">×</button>
                        </div>
                    </div>
                `;
            }).join('');

            // 添加悬停显示操作按钮
            container.querySelectorAll('.memory-item').forEach(item => {
                const actions = item.querySelector('.memory-actions');
                item.addEventListener('mouseenter', () => actions.style.display = 'flex');
                item.addEventListener('mouseleave', () => actions.style.display = 'none');
            });
        }

        // 删除记忆
        function deleteMemory(index) {
            if (!confirm('确定要删除这条记忆吗？')) return;

            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (conv?.settings?.longTermMemory) {
                conv.settings.longTermMemory.splice(index, 1);
                saveWechatData();
                renderWechatMemoryList();
            }
        }

        // 打开添加记忆弹窗
        function openAddMemoryModal() {
            memoryEditingIndex = -1;
            document.getElementById('memoryModalTitle').textContent = '添加记忆';
            document.getElementById('memoryEditContent').value = '';
            document.getElementById('memoryEditModal').classList.add('show');
        }

        // 打开编辑记忆弹窗
        function openEditMemoryModal(index) {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            const memory = conv?.settings?.longTermMemory?.[index];
            if (!memory) return;

            memoryEditingIndex = index;
            document.getElementById('memoryModalTitle').textContent = '编辑记忆';
            document.getElementById('memoryEditContent').value = memory.content;
            document.getElementById('memoryEditModal').classList.add('show');
        }

        // 关闭记忆编辑弹窗
        function closeMemoryEditModal() {
            document.getElementById('memoryEditModal').classList.remove('show');
            memoryEditingIndex = -1;
        }

        // 保存记忆（添加或编辑）
        function saveMemoryEdit() {
            const content = document.getElementById('memoryEditContent').value.trim();
            if (!content) {
                alert('请输入记忆内容');
                return;
            }

            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (!conv) {
                alert('请先进入聊天页面');
                closeMemoryEditModal();
                return;
            }

            if (!conv.settings) conv.settings = {};
            if (!conv.settings.longTermMemory) conv.settings.longTermMemory = [];

            if (memoryEditingIndex >= 0) {
                // 编辑已有记忆
                conv.settings.longTermMemory[memoryEditingIndex].content = content;
                conv.settings.longTermMemory[memoryEditingIndex].editTime = new Date().toISOString();
            } else {
                // 添加新记忆
                conv.settings.longTermMemory.push({
                    type: 'user',
                    content: content,
                    time: new Date().toISOString()
                });
            }

            saveWechatData();
            closeMemoryEditModal();
            renderWechatMemoryList();
        }

        // 手动触发AI总结记忆
        async function triggerManualSummary() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (!conv || !conv.messages || conv.messages.length < 5) {
                alert('对话消息太少，无法生成有效总结（至少需要5条消息）');
                return;
            }

            const statusEl = document.getElementById('wechatMemoryStatus');
            statusEl.innerHTML = '<span style="color: #07c160;">⏳ 正在生成记忆总结...</span>';

            try {
                const summary = await generateMemorySummary(conv);
                if (summary) {
                    if (!conv.settings) conv.settings = {};
                    if (!conv.settings.longTermMemory) conv.settings.longTermMemory = [];

                    conv.settings.longTermMemory.push({
                        type: 'ai',
                        content: summary,
                        time: new Date().toISOString(),
                        messageCount: conv.messages.length
                    });

                    saveWechatData();
                    renderWechatMemoryList();
                    statusEl.innerHTML = '<span style="color: #07c160;">✅ 记忆总结已生成</span>';
                    setTimeout(() => statusEl.innerHTML = '', 3000);
                }
            } catch (err) {
                console.error('生成记忆总结失败:', err);
                statusEl.innerHTML = '<span style="color: #fa5151;">❌ 生成失败: ' + err.message + '</span>';
            }
        }

        // 生成记忆总结（调用AI）
        async function generateMemorySummary(conv) {
            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            const assistantName = assistant?.name || 'AI助手';
            const today = new Date().toLocaleDateString('zh-CN');

            // 获取模型配置（优先使用副模型）
            let modelConfig = null;
            const secondaryModel = appData.settings.secondaryModel;
            const primaryModel = appData.settings.defaultModel;
            const modelToUse = secondaryModel || primaryModel;

            if (modelToUse) {
                const [providerId, modelId] = modelToUse.split('||');
                const provider = appData.providers.find(p => p.id === providerId);
                if (provider) {
                    modelConfig = {
                        provider: provider,
                        model: provider.models.find(m => m.id === modelId)
                    };
                }
            }

            if (!modelConfig) {
                throw new Error('未配置模型，请在设置中选择默认模型');
            }

            // 手动总结：使用用户设置的间隔数，默认50条；上限200条
            const userInterval = conv.settings?.autoSummaryInterval || 50;
            const summaryCount = Math.min(userInterval, 200);
            const recentMessages = conv.messages.slice(-summaryCount);

            const dialogueText = recentMessages.map(msg => {
                const role = msg.role === 'user' ? '用户' : assistantName;
                const content = msg.type === 'image' ? '[图片]' : (msg.type === 'voice' ? '[语音]' : (msg.content || ''));
                return `${role}: ${content}`;
            }).join('\n');

            // 使用330风格的提示词：第一人称、简短、事实导向
            const summaryPrompt = `# 你的任务
你就是"${assistantName}"。请回顾下面和用户的对话，然后用【第一人称 ("我")】的口吻，总结出一段简短的、客观的、包含关键信息的记忆。

# 当前时间
- **今天是：${today}**

# 核心规则
1. **【视角铁律】**: 你的总结【必须】使用【主观的第一人称视角 ("我")】来写。
2. **【内容核心】**: 专注于以下几点：
   * **关键议题**: 我们聊了什么核心话题？
   * **重要决定与共识**: 达成了什么共识或做出了什么决定？
   * **后续计划与任务**: 有没有确定下来什么下一步的行动或计划？
   * **关键信息**: 有没有交换什么重要的信息（如用户的喜好、习惯、重要日期等）？
3. **【时间转换铁律】**: 如果对话中提到了相对时间（如"明天"），结合"今天是${today}"这个信息，将其转换为【具体的日期】。
4. **【风格要求】**: 像一份备忘录或要点记录，不是抒情散文。简洁明了。
5. **【长度限制】**: 总长度控制在100字以内，只记录重要信息。

# 对话记录
${dialogueText}

请直接输出总结内容，不要加任何前缀或格式标记。`;

            const provider = modelConfig.provider;
            const modelId = modelConfig.model.id;

            const response = await fetch(provider.baseUrl + provider.apiPath, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + provider.apiKey
                },
                body: JSON.stringify({
                    model: modelId,
                    messages: [{ role: 'user', content: summaryPrompt }],
                    temperature: 0.5
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
            }

            const data = await response.json();
            if (data.choices && data.choices[0] && data.choices[0].message) {
                return data.choices[0].message.content.trim();
            }

            throw new Error('API返回格式异常');
        }

        // 检查是否需要自动总结（在发送消息后调用）
        function checkAutoSummary() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (!conv || !conv.settings?.autoSummaryEnabled) return;

            const interval = conv.settings.autoSummaryInterval || 50;
            const lastSummaryCount = conv.settings.lastAutoSummaryCount || 0;
            const currentCount = conv.messages?.length || 0;

            if (currentCount - lastSummaryCount >= interval) {
                // 后台执行自动总结
                generateMemorySummary(conv).then(summary => {
                    if (summary) {
                        if (!conv.settings.longTermMemory) conv.settings.longTermMemory = [];
                        conv.settings.longTermMemory.push({
                            type: 'ai',
                            content: summary,
                            time: new Date().toISOString(),
                            messageCount: currentCount,
                            auto: true
                        });
                        conv.settings.lastAutoSummaryCount = currentCount;
                        saveWechatData();
                        console.log('自动记忆总结已生成');
                        showWechatToast('✅ 自动记忆总结已生成', 'success');
                    }
                }).catch(err => {
                    console.error('自动总结失败:', err);
                    let errorMsg = '自动总结失败';
                    if (err.message.includes('HTTP')) {
                        errorMsg = '自动总结失败：模型请求出错';
                    } else if (err.message.includes('未配置模型')) {
                        errorMsg = '自动总结失败：请先配置模型';
                    } else {
                        errorMsg = '自动总结失败：' + err.message.substring(0, 30);
                    }
                    showWechatToast('❌ ' + errorMsg, 'error', 3500);
                });
            }
        }

        // ==================== 长期记忆功能 END ====================
