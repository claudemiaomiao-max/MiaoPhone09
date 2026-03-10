/**
 * 主动发消息模块
 * 负责：定时心跳检查、触发条件判断、生成并发送主动消息
 * 暴露函数：startProactiveTimer, stopProactiveTimer, updateProactiveIntervalVisibility
 * 依赖：appData(data.js), wechatData(微信模块), saveWechatData(微信模块),
 *       renderWechatList(微信模块), getTimeOfDayGreeting(time.js), downloadFile(ui.js)
 */

// ==================== 主动发消息功能 ====================

// 控制间隔输入框的可用状态
function updateProactiveIntervalVisibility() {
    const proactiveOn = document.getElementById('wechatProactive').classList.contains('on');
    const intervalItem = document.getElementById('wechatProactiveIntervalItem');
    if (intervalItem) {
        intervalItem.style.opacity = proactiveOn ? '1' : '0.5';
        intervalItem.style.pointerEvents = proactiveOn ? 'auto' : 'none';
    }
}

// 后台心跳定时器
let proactiveTimerId = null;
let proactiveRunning = false; // 防止并发

function startProactiveTimer() {
    if (proactiveTimerId) return;
    proactiveTimerId = setInterval(proactiveHeartbeat, 30 * 1000); // 每30秒检查一次
    console.log('主动发消息：心跳定时器已启动');
}

function stopProactiveTimer() {
    if (proactiveTimerId) {
        clearInterval(proactiveTimerId);
        proactiveTimerId = null;
        console.log('主动发消息：心跳定时器已停止');
    }
}

// 心跳：遍历所有对话，检查是否需要触发主动发消息
async function proactiveHeartbeat() {
    if (proactiveRunning) return; // 防止并发
    proactiveRunning = true;

    try {
        const conversations = wechatData.conversations;
        if (!conversations) return;

        for (const [assistantId, conv] of Object.entries(conversations)) {
            const settings = conv.settings || {};

            // 未开启主动发消息，跳过
            if (!settings.proactiveEnabled) continue;

            // 当前正在查看的对话，跳过
            if (assistantId === wechatData.currentAssistantId) continue;

            // 没有消息记录，跳过
            if (!conv.messages || conv.messages.length === 0) continue;

            // 检查冷却时间
            const intervalMs = (settings.proactiveInterval || 15) * 60 * 1000;
            const lastProactive = settings.lastProactiveTimestamp || 0;
            const now = Date.now();

            if (now - lastProactive < intervalMs) continue;

            // 检查距离最后一条消息的时间是否超过间隔
            const lastMsg = conv.messages[conv.messages.length - 1];
            const lastMsgTime = typeof lastMsg.timestamp === 'number'
                ? lastMsg.timestamp
                : new Date(lastMsg.timestamp).getTime();

            if (now - lastMsgTime < intervalMs) continue;

            // 20% 概率触发
            if (Math.random() > 0.20) continue;

            console.log(`主动发消息：角色 "${assistantId}" 触发主动行动`);

            // 触发主动发消息
            await triggerProactiveMessage(assistantId, conv);
        }
    } catch (e) {
        console.error('主动发消息心跳出错:', e);
    } finally {
        proactiveRunning = false;
    }
}

// 触发主动发消息
async function triggerProactiveMessage(assistantId, conv) {
    const assistant = appData.assistants.find(a => a.id === assistantId);
    if (!assistant) return;

    const assistantName = assistant.name || 'AI助手';
    const settings = conv.settings || {};

    // 获取模型配置（优先使用副模型）
    const secondaryModel = appData.settings.secondaryModel;
    const primaryModel = appData.settings.defaultModel;
    const modelToUse = secondaryModel || primaryModel;

    if (!modelToUse) {
        console.warn('主动发消息：未配置模型');
        return;
    }

    const [providerId, modelId] = modelToUse.split('||');
    const provider = appData.providers.find(p => p.id === providerId);
    if (!provider) {
        console.warn('主动发消息：找不到供应商');
        return;
    }

    // 构建上下文（最近50条消息的摘要）
    const recentMessages = conv.messages.slice(-50);
    const dialogueSummary = recentMessages.map(msg => {
        const role = msg.role === 'user' ? '用户' : assistantName;
        if (msg.type === 'image') return `${role}: [图片]`;
        if (msg.type === 'voice_message') return `${role}: ${msg.content || ''}`;
        if (msg.type === 'pat_message') return null;
        if (msg.type === 'transfer') return `[转账] ${msg.senderName} 向 ${msg.receiverName} 转账 ¥${msg.amount}`;
        return `${role}: ${msg.content || ''}`;
    }).filter(Boolean).join('\n');

    // 计算时间间隔信息
    const now = new Date();
    const lastMsg = recentMessages[recentMessages.length - 1];
    const lastMsgTime = typeof lastMsg.timestamp === 'number'
        ? lastMsg.timestamp
        : new Date(lastMsg.timestamp).getTime();
    const gapMs = now.getTime() - lastMsgTime;
    const gapHours = gapMs / (60 * 60 * 1000);
    const gapDays = Math.floor(gapHours / 24);

    let gapText;
    if (gapDays >= 2) {
        gapText = `${gapDays}天`;
    } else if (gapDays >= 1) {
        gapText = '一天';
    } else if (gapHours >= 1) {
        gapText = `约${Math.round(gapHours)}小时`;
    } else {
        gapText = `约${Math.round(gapMs / 60000)}分钟`;
    }

    const timeOfDay = getTimeOfDayGreeting(now);
    const currentTime = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;

    // 长期记忆
    const longTermMemory = settings.longTermMemory || [];
    const memoryText = longTermMemory.length > 0
        ? longTermMemory.map(m => `- ${m.content}`).join('\n')
        : '(暂无)';

    // 构建提示词
    const systemPrompt = `# 你的任务
你正在扮演"${assistantName}"。你已经有一段时间没有和用户互动了，现在你有机会主动给用户发一条消息。

# 你的角色设定
${assistant.systemPrompt || '无特殊设定'}

# 当前情景
- 当前时间: ${currentTime} (${timeOfDay})
- 距离上次对话: 已过${gapText}
- 上次对话中最后发言的是: ${lastMsg.role === 'user' ? '用户' : assistantName}

# 长期记忆
${memoryText}

# 你们最近的对话记录
${dialogueSummary}

# 行为指引
- 根据当前时间、你们最近的对话内容、以及你的角色设定，主动给用户发一条自然的消息
- 可以是问候、关心、分享日常、延续之前的话题、或开启新话题
- 像真人一样，消息要简短自然，不要一次发太长
- 注意当前时间段，${timeOfDay}不合适的内容就不要发（比如凌晨不要发太活跃的消息）

# 输出格式
你的回复【必须】是一个JSON数组，每个元素是一条消息对象。
示例: [{"type": "text", "content": "消息内容"}]
可以发多条短消息: [{"type": "text", "content": "在吗？"}, {"type": "text", "content": "刚看到一个好玩的东西想跟你分享"}]
【再次强调】你的输出必须是纯JSON数组，以 [ 开头，以 ] 结尾，中间不能有任何其他内容。`;

    const requestMessages = [
        { role: 'user', content: systemPrompt }
    ];

    try {
        const response = await fetch(provider.baseUrl + provider.apiPath, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + provider.apiKey
            },
            body: JSON.stringify({
                model: modelId,
                messages: requestMessages,
                temperature: 0.9
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`主动发消息API失败: ${response.status}`, errorText.substring(0, 200));
            return;
        }

        const data = await response.json();
        const replyContent = data.choices[0].message.content;
        console.log('主动发消息API回复:', replyContent.substring(0, 300));

        // 解析回复（简化版，不依赖当前对话上下文）
        let replies = [];
        let trimmed = replyContent.trim();
        // 清理思考链
        trimmed = trimmed.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
        trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, '');
        trimmed = trimmed.trim();

        try {
            if (trimmed.includes('```')) {
                trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
            }
            if (trimmed.startsWith('[')) {
                replies = JSON.parse(trimmed);
            } else {
                const match = trimmed.match(/\[[\s\S]*\]/);
                if (match) replies = JSON.parse(match[0]);
            }
        } catch (e) {
            console.warn('主动发消息：JSON解析失败，作为纯文本处理');
            replies = [{ type: 'text', content: replyContent }];
        }

        // 过滤掉思维链
        replies = replies.filter(r => r.type !== 'thinking');
        if (replies.length === 0) {
            console.warn('主动发消息：解析后没有有效回复');
            return;
        }

        // 添加消息到对话记录
        replies.forEach((reply, index) => {
            const msgToAdd = {
                id: 'wproactive_' + Date.now() + '_' + index,
                role: 'assistant',
                type: reply.type || 'text',
                content: reply.content || '',
                emotion: reply.emotion || 'neutral',
                timestamp: new Date().toISOString()
            };
            conv.messages.push(msgToAdd);
        });

        // 更新冷却时间戳
        if (!conv.settings) conv.settings = {};
        conv.settings.lastProactiveTimestamp = Date.now();

        // 不在目标窗口时累加未读数
        if (wechatData.currentAssistantId !== assistantId) {
            wechatUnreadCounts[assistantId] = (wechatUnreadCounts[assistantId] || 0) + replies.length;
        }

        // 保存并更新列表UI
        saveWechatData();
        renderWechatList();

        console.log(`主动发消息：角色 "${assistantName}" 已发送 ${replies.length} 条消息`);

    } catch (e) {
        console.error('主动发消息请求出错:', e);
    }
}

