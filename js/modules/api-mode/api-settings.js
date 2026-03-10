/**
 * API模式设置
 *
 * 负责：API模式专属设置（上下文长度、流式开关、附件缓存清理）
 * 暴露函数：openApiSettings, autoSaveApiSettings, closeApiSettings,
 *           updateApiAttachmentCacheDesc, clearApiAttachmentCache
 * 依赖：appData(data.js), saveData(storage.js), openPage/closePage(navigation.js),
 *        renderMessages(api-chat.js), closeSidebarInstantly(api-chat.js)
 */

        function openApiSettings() {
            // 数据迁移：首次使用时从助手级别迁移
            if (appData.settings.apiContextLength === undefined) {
                const assistant = appData.assistants.find(a => a.id === appData.currentAssistantId);
                appData.settings.apiContextLength = assistant?.contextLength || 20;
            }
            if (appData.settings.apiStreamEnabled === undefined) {
                appData.settings.apiStreamEnabled = true;
            }

            // 关掉侧边栏再打开设置页
            closeSidebarInstantly();

            document.getElementById('apiContextLengthInput').value = appData.settings.apiContextLength;
            const sw = document.getElementById('apiStreamEnabledSwitch');
            if (appData.settings.apiStreamEnabled) {
                sw.classList.add('on');
            } else {
                sw.classList.remove('on');
            }
            openPage('apiSettingsPage');
            updateApiAttachmentCacheDesc();
        }

        function autoSaveApiSettings() {
            appData.settings.apiContextLength = parseInt(document.getElementById('apiContextLengthInput').value) || 20;
            appData.settings.apiStreamEnabled = document.getElementById('apiStreamEnabledSwitch').classList.contains('on');
            saveData();
        }

        function closeApiSettings() {
            autoSaveApiSettings();
            closePage('apiSettingsPage');
        }

        function updateApiAttachmentCacheDesc() {
            let imageCount = 0;
            let fileCount = 0;
            for (const convId in appData.messages) {
                const msgs = appData.messages[convId];
                if (!Array.isArray(msgs)) continue;
                for (const msg of msgs) {
                    // 统计有图片预览的附件
                    if (msg.attachments) {
                        for (const att of msg.attachments) {
                            if (att.isImage && att.preview) imageCount++;
                        }
                    }
                    // 统计apiContent里的图片（multimodal格式）
                    if (Array.isArray(msg.apiContent)) {
                        for (const part of msg.apiContent) {
                            if (part.type === 'image_url' && part.image_url?.url) imageCount++;
                        }
                    }
                    // 统计文件消息
                    if (msg.isFile && msg.content && !msg.content.includes('（内容已清除）')) fileCount++;
                }
            }
            const desc = document.getElementById('apiAttachmentCacheDesc');
            if (imageCount === 0 && fileCount === 0) {
                desc.textContent = '无缓存';
            } else {
                const parts = [];
                if (imageCount > 0) parts.push(`${imageCount} 张图片`);
                if (fileCount > 0) parts.push(`${fileCount} 个文件`);
                desc.textContent = `当前：${parts.join(' / ')}`;
            }
        }

        function clearApiAttachmentCache() {
            // 先统计
            let imageCount = 0;
            let fileCount = 0;
            for (const convId in appData.messages) {
                const msgs = appData.messages[convId];
                if (!Array.isArray(msgs)) continue;
                for (const msg of msgs) {
                    if (msg.attachments) {
                        for (const att of msg.attachments) {
                            if (att.isImage && att.preview) imageCount++;
                        }
                    }
                    if (Array.isArray(msg.apiContent)) {
                        for (const part of msg.apiContent) {
                            if (part.type === 'image_url' && part.image_url?.url) imageCount++;
                        }
                    }
                    if (msg.isFile && msg.content && !msg.content.includes('（内容已清除）')) fileCount++;
                }
            }

            if (imageCount === 0 && fileCount === 0) {
                alert('没有附件缓存需要清除');
                return;
            }

            const parts = [];
            if (imageCount > 0) parts.push(`${imageCount} 张图片`);
            if (fileCount > 0) parts.push(`${fileCount} 个文件`);
            if (!confirm(`确定要清除所有对话中的附件缓存吗？\n${parts.join(' / ')}\n\n清除后图片将显示为占位符，文件内容不可恢复。`)) return;

            // 执行清除
            for (const convId in appData.messages) {
                const msgs = appData.messages[convId];
                if (!Array.isArray(msgs)) continue;
                for (const msg of msgs) {
                    // 清除附件预览
                    if (msg.attachments) {
                        for (const att of msg.attachments) {
                            if (att.isImage && att.preview) {
                                att.preview = null;
                            }
                        }
                    }
                    // 清除apiContent里的图片数据
                    if (Array.isArray(msg.apiContent)) {
                        msg.apiContent = msg.apiContent.filter(part => part.type !== 'image_url');
                        // 如果只剩文本，简化回字符串
                        if (msg.apiContent.length === 1 && msg.apiContent[0].type === 'text') {
                            msg.apiContent = msg.apiContent[0].text;
                        } else if (msg.apiContent.length === 0) {
                            msg.apiContent = msg.content || '[附件已清除]';
                        }
                    }
                    // 清除文件消息内容
                    if (msg.isFile && msg.content && !msg.content.includes('（内容已清除）')) {
                        msg.content = `[文件: ${msg.fileName || '未知文件'}]（内容已清除）`;
                    }
                }
            }

            saveData();
            renderMessages();
            updateApiAttachmentCacheDesc();
            alert('附件缓存已清除');
        }
