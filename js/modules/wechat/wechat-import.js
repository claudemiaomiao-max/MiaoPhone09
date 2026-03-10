/**
 * 微信模式 - 导出/导入/缓存管理
 *
 * 负责：导出微信聊天记录、清理图片/文件缓存、导入聊天记录、清空聊天
 * 暴露函数：exportWechatChat, clearImageCache, clearFileCache,
 *           importWechatChat, clearWechatChat
 * 依赖：appData(data.js), wechatData/saveWechatData/renderWechatMessages(wechat-core.js),
 *        downloadFile(ui.js), closePage(navigation.js),
 *        showExportFormatModal(wechat-ui.js)
 */

        function exportWechatChat() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (!conv || conv.messages.length === 0) {
                alert('没有聊天记录可导出');
                return;
            }

            const assistant = appData.assistants.find(a => a.id === wechatData.currentAssistantId);
            const assistantName = assistant?.name || 'chat';

            showExportFormatModal(function(format) {
                function getMsgContent(m) {
                    if (m.type === 'image') return '[图片]';
                    if (m.type === 'voice_message') return `🎤 ${m.content || ''}`;
                    if (m.type === 'transfer') return `💰 转账 ¥${m.amount?.toFixed(2) || '0.00'}${m.note ? ' ' + m.note : ''}`;
                    return m.content || '';
                }

                function quotePrefix(m, style) {
                    if (!m.quote) return '';
                    const who = m.quote.senderName || '';
                    const what = (m.quote.content || '').substring(0, 100);
                    if (style === 'md') return `> 引用 ${who}：${what}\n\n`;
                    if (style === 'txt') return `[引用 ${who}："${what}"]\n`;
                    return '';
                }

                if (format === 'md') {
                    let md = `# 聊天记录 - ${assistantName}\n\n`;
                    if (conv.settings?.longTermMemory?.length > 0) {
                        md += `## 长期记忆\n\n${conv.settings.longTermMemory}\n\n---\n\n`;
                    }
                    let lastDate = '';
                    for (const m of conv.messages) {
                        if (m.type === 'pat_message' || m.type === 'system') { md += `> ${m.content || ''}\n\n`; continue; }
                        const dt = new Date(m.timestamp);
                        const date = dt.toLocaleDateString('zh-CN');
                        if (date !== lastDate) { md += `## ${date}\n\n`; lastDate = date; }
                        const time = dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                        const name = m.role === 'user' ? '我' : assistantName;
                        md += `**${name}** (${time})\n\n${quotePrefix(m, 'md')}${getMsgContent(m)}\n\n---\n\n`;
                    }
                    downloadFile(md, `wechat_${assistantName}_${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
                } else if (format === 'txt') {
                    let txt = `聊天记录 - ${assistantName}\n\n`;
                    if (conv.settings?.longTermMemory?.length > 0) {
                        txt += `--- 长期记忆 ---\n${conv.settings.longTermMemory}\n\n`;
                    }
                    let lastDate = '';
                    for (const m of conv.messages) {
                        if (m.type === 'pat_message' || m.type === 'system') { txt += `[${m.content || ''}]\n\n`; continue; }
                        const dt = new Date(m.timestamp);
                        const date = dt.toLocaleDateString('zh-CN');
                        if (date !== lastDate) { txt += `--- ${date} ---\n\n`; lastDate = date; }
                        const time = dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                        const name = m.role === 'user' ? '我' : assistantName;
                        txt += `${name} (${time})\n${quotePrefix(m, 'txt')}${getMsgContent(m)}\n\n`;
                    }
                    downloadFile(txt, `wechat_${assistantName}_${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain');
                } else {
                    const messagesWithoutImages = conv.messages.map(msg => {
                        if (msg.type === 'image') return { ...msg, content: '[图片已移除]', thumbnail: msg.thumbnail || null };
                        return msg;
                    });
                    const exportObj = { assistant: assistantName, exportTime: new Date().toISOString(), messages: messagesWithoutImages };
                    if (conv.settings?.longTermMemory?.length > 0) exportObj.longTermMemory = conv.settings.longTermMemory;
                    const dataStr = JSON.stringify(exportObj, null, 2);
                    downloadFile(dataStr, `wechat_${assistantName}_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
                }
            });
        }

        // 清除图片缓存（图片数据在msg.content中）
        function clearWechatImageCache() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (!conv) return;

            // 先统计图片数量
            const imageCount = conv.messages.filter(msg =>
                msg.type === 'image' && msg.content && msg.content.startsWith('data:')
            ).length;

            if (imageCount === 0) {
                alert('没有图片缓存需要清除');
                return;
            }

            // 确认弹窗
            if (!confirm(`确定要清除 ${imageCount} 张图片缓存吗？\n清除后图片将显示为占位符，无法恢复。`)) {
                return;
            }

            // 执行清除
            conv.messages.forEach(msg => {
                if (msg.type === 'image' && msg.content && msg.content.startsWith('data:')) {
                    msg.thumbnail = null;
                    msg.content = null;
                }
            });

            saveWechatData();
            renderWechatMessages();
            document.getElementById('wechatImageCacheCount').textContent = '0 张';
            alert(`已清除 ${imageCount} 张图片缓存`);
        }

        // 清除文件缓存（isFile标记的文本文件消息内容）
        function clearWechatFileCache() {
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (!conv) return;

            const fileCount = conv.messages.filter(msg => msg.isFile && msg.content && !msg.content.includes('（内容已清除）')).length;

            if (fileCount === 0) {
                alert('没有文件缓存需要清除');
                return;
            }

            if (!confirm(`确定要清除 ${fileCount} 个文件缓存吗？\n清除后文件内容将显示为占位符，无法恢复。`)) {
                return;
            }

            conv.messages.forEach(msg => {
                if (msg.isFile && msg.content && !msg.content.includes('（内容已清除）')) {
                    msg.content = `[文件: ${msg.fileName || '未知文件'}]（内容已清除）`;
                }
            });

            saveWechatData();
            renderWechatMessages();
            document.getElementById('wechatFileCacheCount').textContent = '0 个';
            alert(`已清除 ${fileCount} 个文件缓存`);
        }

        function importWechatChat() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    
                    if (!data.messages || !Array.isArray(data.messages)) {
                        throw new Error('无效的聊天记录格式');
                    }
                    
                    const conv = wechatData.conversations[wechatData.currentAssistantId];
                    if (!conv) {
                        alert('请先选择一个助手');
                        return;
                    }
                    
                    const mode = confirm('点击"确定"追加到现有记录\n点击"取消"替换现有记录');

                    if (mode) {
                        // 追加模式
                        conv.messages = conv.messages.concat(data.messages);
                    } else {
                        // 替换模式
                        conv.messages = data.messages;
                    }

                    // 恢复长期记忆
                    if (data.longTermMemory && Array.isArray(data.longTermMemory)) {
                        if (!conv.settings) conv.settings = {};
                        if (mode && conv.settings.longTermMemory?.length > 0) {
                            // 追加模式：合并去重（按content去重）
                            const existing = new Set(conv.settings.longTermMemory.map(m => m.content));
                            const newMemories = data.longTermMemory.filter(m => !existing.has(m.content));
                            conv.settings.longTermMemory = conv.settings.longTermMemory.concat(newMemories);
                        } else {
                            // 替换模式或原本没有记忆
                            conv.settings.longTermMemory = data.longTermMemory;
                        }
                    }

                    saveWechatData();
                    renderWechatMessages();
                    const memoryInfo = data.longTermMemory?.length ? `，${data.longTermMemory.length} 条长期记忆` : '';
                    alert(`成功导入 ${data.messages.length} 条消息${memoryInfo}`);
                } catch (err) {
                    alert('导入失败: ' + err.message);
                }
            };
            input.click();
        }

        function clearWechatChat() {
            if (!confirm('确定要清空聊天记录吗？此操作不可恢复。')) return;
            
            const conv = wechatData.conversations[wechatData.currentAssistantId];
            if (conv) {
                conv.messages = [];
                saveWechatData();
                renderWechatMessages();
            }
            closePage('wechatSettingsPage');
        }

