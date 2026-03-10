/**
 * 调试函数（控制台使用）
 *
 * 负责：debugData, forceReloadData, clearAllData
 * 依赖：appData(data.js), wechatData(wechat-core.js), diaryData(diary.js),
 *        initIndexedDB/loadData(storage.js), initWechatData(wechat-core.js)
 */

        // ==================== 调试函数（控制台使用） ====================
        // 查看当前数据状态
        window.debugData = function() {
            console.log('=== 数据调试信息 ===');
            console.log('appData.assistants 数量:', appData.assistants?.length || 0);
            console.log('appData.assistants:', appData.assistants?.map(a => ({id: a.id, name: a.name})));
            console.log('wechatData.importedAssistants:', wechatData.importedAssistants);

            // 显示conversations中有聊天记录的助手
            const conversationIds = Object.keys(wechatData.conversations || {});
            const withMessages = conversationIds.filter(id =>
                wechatData.conversations[id]?.messages?.length > 0
            );
            console.log('wechatData.conversations 有聊天记录的助手ID:', withMessages);

            console.log('diaryData.currentAssistantId:', diaryData?.currentAssistantId);

            // 检查哪些已导入的助手在appData中找不到
            const missing = wechatData.importedAssistants?.filter(id =>
                !appData.assistants?.find(a => a.id === id)
            );
            if (missing?.length) {
                console.warn('⚠️ 以下已导入的助手ID在appData中找不到:', missing);
            }

            // 计算日记模式可用的助手（新逻辑）
            const diaryAssistants = appData.assistants?.filter(a =>
                wechatData.importedAssistants?.includes(a.id) ||
                wechatData.conversations?.[a.id]?.messages?.length > 0 ||
                (diaryData?.diaries?.[a.id]?.entries?.length > 0)
            );
            console.log('日记模式可用助手:', diaryAssistants?.map(a => ({id: a.id, name: a.name})));

            return {
                assistants: appData.assistants,
                importedAssistants: wechatData.importedAssistants,
                conversationsWithMessages: withMessages,
                diaryAssistants: diaryAssistants
            };
        };

        // 强制重新加载数据
        window.forceReloadData = async function() {
            console.log('正在强制重新加载数据...');
            await loadData();
            await initWechatData();
            loadDiaryData();
            console.log('数据重新加载完成');
            window.debugData();
        };

        // 清除所有本地数据（谨慎使用）
        window.clearAllData = function() {
            if (!confirm('确定要清除所有本地数据吗？这将删除所有助手、聊天记录和日记！')) return;
            if (!confirm('再次确认：此操作不可恢复！')) return;

            // 清除 IndexedDB
            if (dbInstance) {
                const stores = ['appData', 'wechatData', 'diaryData'];
                stores.forEach(store => {
                    try {
                        const tx = dbInstance.transaction(store, 'readwrite');
                        tx.objectStore(store).clear();
                    } catch(e) {}
                });
            }

            // 清除 localStorage
            localStorage.removeItem('miaomiao_chat_v5');
            localStorage.removeItem('miaomiao_wechat_v1');
            localStorage.removeItem('miaomiao_diary_v1');

            alert('数据已清除，请刷新页面');
        };

