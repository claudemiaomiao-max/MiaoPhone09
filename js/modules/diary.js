/**
 * 日记模式模块
 * 负责：日记数据管理、日历、生成、详情、滑动切换、自动定时写日记
 * 暴露函数：loadDiaryData, saveDiaryData, openDiaryMode, setupDiaryAutoSchedule
 * 依赖：appData(data.js), loadData(storage.js), initWechatData(微信模块),
 *       openPage/closePage(navigation.js), escapeHtml(ui.js), downloadFile(ui.js)
 */

// ==================== 日记模式功能 ====================
let diaryData = {
    currentAssistantId: null,
    currentDiaryId: null,
    diaries: {}, // { assistantId: { entries: [], autoWrite: false } }
};

// 日历状态
let diaryCalendarYear = new Date().getFullYear();
let diaryCalendarMonth = new Date().getMonth();
let diarySelectedDate = null;

// 加载日记数据
function loadDiaryData() {
    try {
        const saved = localStorage.getItem('miaomiao_diary_data');
        if (saved) {
            diaryData = { ...diaryData, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.error('加载日记数据失败:', e);
    }
}

// 保存日记数据
function saveDiaryData() {
    try {
        localStorage.setItem('miaomiao_diary_data', JSON.stringify(diaryData));
        _cloudSyncDirty.diaryData = true;
    } catch (e) {
        console.error('保存日记数据失败:', e);
    }
}

// 打开日记模式
async function openDiaryMode() {
    // 确保appData和wechatData都已加载（用于获取助手列表和聊天记录）
    await loadData();
    await initWechatData();
    loadDiaryData();

    // 获取可用于日记的助手（在微信模式有聊天记录或已有日记的）
    const diaryAssistants = appData.assistants?.filter(a =>
        wechatData.importedAssistants?.includes(a.id) ||
        wechatData.conversations?.[a.id]?.messages?.length > 0 ||  // 有聊天记录
        (diaryData.diaries[a.id] && diaryData.diaries[a.id].entries?.length > 0)
    ) || [];

    // 默认选择第一个可用助手
    if (!diaryData.currentAssistantId && diaryAssistants.length > 0) {
        diaryData.currentAssistantId = diaryAssistants[0].id;
    }
    // 如果当前选中的助手不在列表中，重新选择
    if (diaryData.currentAssistantId && !diaryAssistants.find(a => a.id === diaryData.currentAssistantId)) {
        diaryData.currentAssistantId = diaryAssistants.length > 0 ? diaryAssistants[0].id : null;
    }

    // 初始化日历为当前月
    diaryCalendarYear = new Date().getFullYear();
    diaryCalendarMonth = new Date().getMonth();
    diarySelectedDate = null;

    renderDiaryAssistantSelector();
    renderDiaryCalendar();
    updateDiaryAutoSwitch();
    renderDiaryContentArea();
    openPage('diaryListPage');
}

// 渲染助手选择器
function renderDiaryAssistantSelector() {
    const assistant = appData.assistants?.find(a => a.id === diaryData.currentAssistantId);
    const avatarEl = document.getElementById('diarySelectedAvatar');
    const nameEl = document.getElementById('diarySelectedName');

    if (assistant) {
        avatarEl.innerHTML = assistant.avatar
            ? `<img src="${assistant.avatar}" alt="">`
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
        nameEl.textContent = assistant.name;
    } else {
        avatarEl.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
        nameEl.textContent = appData.assistants?.length ? '选择助手' : '暂无助手';
    }

    // 渲染下拉列表
    const dropdown = document.getElementById('diaryAssistantDropdown');
    if (!appData.assistants?.length) {
        dropdown.innerHTML = '<div style="padding: 16px; text-align: center; color: #999;">请先创建助手</div>';
        return;
    }

    // 只显示在微信模式有聊天记录的助手（或已有日记的助手）
    const diaryAssistants = appData.assistants.filter(a =>
        wechatData.importedAssistants?.includes(a.id) ||
        wechatData.conversations?.[a.id]?.messages?.length > 0 ||  // 有聊天记录
        (diaryData.diaries[a.id] && diaryData.diaries[a.id].entries?.length > 0)
    );

    if (!diaryAssistants.length) {
        dropdown.innerHTML = '<div style="padding: 16px; text-align: center; color: #999;">请先在微信模式导入助手</div>';
        return;
    }

    dropdown.innerHTML = diaryAssistants.map(a => {
        const diaryInfo = diaryData.diaries[a.id] || { entries: [] };
        const count = diaryInfo.entries?.length || 0;
        const isSelected = a.id === diaryData.currentAssistantId;
        return `
            <div class="diary-assistant-dropdown-item${isSelected ? ' selected' : ''}" onclick="selectDiaryAssistant('${a.id}')">
                <div class="diary-assistant-dropdown-avatar">
                    ${a.avatar ? `<img src="${a.avatar}" alt="">` : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}
                </div>
                <span class="diary-assistant-dropdown-name">${escapeHtml(a.name)}</span>
                <span class="diary-assistant-dropdown-count">${count}篇</span>
            </div>
        `;
    }).join('');
}

// 切换助手下拉菜单
function toggleDiaryAssistantDropdown() {
    const dropdown = document.getElementById('diaryAssistantDropdown');
    const arrow = document.getElementById('diaryAssistantArrow');
    dropdown.classList.toggle('show');
    arrow.classList.toggle('open');
}

// 选择助手
function selectDiaryAssistant(assistantId) {
    diaryData.currentAssistantId = assistantId;
    toggleDiaryAssistantDropdown();
    renderDiaryAssistantSelector();
    renderDiaryCalendar();
    updateDiaryAutoSwitch();
    renderDiaryContentArea();
}

// 更新自动写日记开关
function updateDiaryAutoSwitch() {
    const autoSwitch = document.getElementById('diaryAutoSwitch');
    const assistantId = diaryData.currentAssistantId;
    if (assistantId && diaryData.diaries[assistantId]) {
        autoSwitch.classList.toggle('on', diaryData.diaries[assistantId].autoWrite);
    } else {
        autoSwitch.classList.remove('on');
    }
}

// 获取助手的聊天日期集合
function getChatDatesForAssistant(assistantId) {
    const chatDates = new Set();
    const conv = wechatData.conversations?.[assistantId];
    if (conv?.messages) {
        conv.messages.forEach(msg => {
            if (msg.timestamp) {
                const d = typeof msg.timestamp === 'number' ? new Date(msg.timestamp) : new Date(msg.timestamp);
                chatDates.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
            }
        });
    }
    return chatDates;
}

// 渲染日历
function renderDiaryCalendar() {
    const titleEl = document.getElementById('diaryCalendarTitle');
    const daysEl = document.getElementById('diaryCalendarDays');

    titleEl.textContent = `${diaryCalendarYear}年${diaryCalendarMonth + 1}月`;

    // 获取当月第一天和最后一天
    const firstDay = new Date(diaryCalendarYear, diaryCalendarMonth, 1);
    const lastDay = new Date(diaryCalendarYear, diaryCalendarMonth + 1, 0);
    const startWeekday = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    // 获取当前助手的日记日期列表
    const diaryDates = new Set();
    const entries = diaryData.diaries[diaryData.currentAssistantId]?.entries || [];
    entries.forEach(e => {
        const d = new Date(e.date);
        diaryDates.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    });

    // 获取聊天日期列表
    const chatDates = getChatDatesForAssistant(diaryData.currentAssistantId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

    let html = '';

    // 上个月的日期（填充）
    const prevMonthDays = new Date(diaryCalendarYear, diaryCalendarMonth, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
        const day = prevMonthDays - i;
        html += `<div class="diary-calendar-day other-month">${day}</div>`;
    }

    // 当月日期
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${diaryCalendarYear}-${diaryCalendarMonth}-${day}`;
        const dateObj = new Date(diaryCalendarYear, diaryCalendarMonth, day);
        dateObj.setHours(0, 0, 0, 0);

        const isToday = dateStr === todayStr;
        const hasDiary = diaryDates.has(dateStr);
        const hasChat = chatDates.has(dateStr);
        const isSelected = diarySelectedDate === dateStr;
        const isFuture = dateObj > today;

        // 检查前后日期是否也有聊天（用于色块融合）
        const prevDay = new Date(diaryCalendarYear, diaryCalendarMonth, day - 1);
        const nextDay = new Date(diaryCalendarYear, diaryCalendarMonth, day + 1);
        const prevDateStr = `${prevDay.getFullYear()}-${prevDay.getMonth()}-${prevDay.getDate()}`;
        const nextDateStr = `${nextDay.getFullYear()}-${nextDay.getMonth()}-${nextDay.getDate()}`;
        const hasPrevChat = chatDates.has(prevDateStr);
        const hasNextChat = chatDates.has(nextDateStr);

        let classes = 'diary-calendar-day';
        if (isToday) classes += ' today';
        if (hasDiary) classes += ' has-diary';
        if (hasChat) {
            classes += ' has-chat';
            // 连续聊天日期色块融合
            if (hasPrevChat) classes += ' chat-continue-left';
            if (hasNextChat) classes += ' chat-continue-right';
        }
        if (isSelected) classes += ' selected';
        if (isFuture) classes += ' future';

        const clickHandler = isFuture ? '' : `onclick="selectDiaryDate('${dateStr}')"`;
        html += `<div class="${classes}" ${clickHandler}>${day}</div>`;
    }

    // 下个月的日期（填充）
    const totalCells = startWeekday + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day++) {
        html += `<div class="diary-calendar-day other-month">${day}</div>`;
    }

    daysEl.innerHTML = html;
}

// 日历导航
function diaryCalendarPrevMonth() {
    diaryCalendarMonth--;
    if (diaryCalendarMonth < 0) {
        diaryCalendarMonth = 11;
        diaryCalendarYear--;
    }
    renderDiaryCalendar();
}

function diaryCalendarNextMonth() {
    diaryCalendarMonth++;
    if (diaryCalendarMonth > 11) {
        diaryCalendarMonth = 0;
        diaryCalendarYear++;
    }
    renderDiaryCalendar();
}

// 选择日期 - 直接打开日记详情或显示生成选项
function selectDiaryDate(dateStr) {
    diarySelectedDate = dateStr;
    renderDiaryCalendar();
    // 统一显示概览（不直接跳转详情页）
    renderDiaryContentArea();
}

// 渲染日记内容区域（显示概览和日记预览）
function renderDiaryContentArea() {
    const container = document.getElementById('diaryContentArea');

    if (!diarySelectedDate) {
        container.innerHTML = `
            <div class="diary-no-entry">
                <div class="diary-no-entry-icon">📖</div>
                <div>选择一个日期查看日记</div>
            </div>
        `;
        return;
    }

    // 解析选中日期
    const [year, month, day] = diarySelectedDate.split('-').map(Number);
    const selectedDateObj = new Date(year, month, day);
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const dateDisplay = `${year}年${month + 1}月${day}日 ${weekDays[selectedDateObj.getDay()]}`;

    // 获取当前助手名称
    const assistant = appData.assistants?.find(a => a.id === diaryData.currentAssistantId);
    const assistantName = assistant?.name || '助手';

    // 检查是否有聊天记录
    const chatDates = getChatDatesForAssistant(diaryData.currentAssistantId);
    const hasChat = chatDates.has(diarySelectedDate);

    // 查找当天的日记
    const entries = diaryData.diaries[diaryData.currentAssistantId]?.entries || [];
    const dayEntries = entries.filter(e => {
        const d = new Date(e.date);
        return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });

    // 生成日记预览HTML
    let diaryPreviewsHtml = '';
    if (dayEntries.length > 0) {
        diaryPreviewsHtml = dayEntries.map((entry, idx) => {
            // 取前60个字符作为预览
            const preview = entry.content.substring(0, 60) + (entry.content.length > 60 ? '...' : '');
            return `
                <div onclick="openDiaryDetailForDateWithIndex('${diarySelectedDate}', ${idx})" style="
                    background: #fff;
                    border-radius: 12px;
                    padding: 12px;
                    margin-bottom: 10px;
                    cursor: pointer;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    transition: transform 0.2s;
                " onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                    <div style="font-size: 12px; color: #a8879a; margin-bottom: 6px;">
                        ${entry.weather || ''} 第${idx + 1}篇
                    </div>
                    <div style="font-size: 14px; color: #5a4a4a; line-height: 1.5;">
                        ${escapeHtml(preview)}
                    </div>
                </div>
            `;
        }).join('');
    }

    container.innerHTML = `
        <div style="padding: 16px;">
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="font-size: 16px; font-weight: 500; color: #5a4a4a;">${dateDisplay}</div>
                <div style="font-size: 13px; margin-top: 6px; color: #999;">
                    ${hasChat ? `这一天有和${assistantName}对话` : `这一天没有和${assistantName}对话`}
                </div>
            </div>
            ${dayEntries.length > 0 ? `
                <div style="margin-bottom: 16px;">
                    <div style="font-size: 13px; color: #a8879a; margin-bottom: 8px;">已有 ${dayEntries.length} 篇日记</div>
                    ${diaryPreviewsHtml}
                </div>
            ` : ''}
            <div style="text-align: center;">
                <button id="diaryGenerateBtn" onclick="generateDiaryForDate('${diarySelectedDate}')" style="
                    padding: 10px 24px;
                    background: linear-gradient(135deg, #c9a8b8, #a8879a);
                    border: none;
                    border-radius: 20px;
                    color: #fff;
                    font-size: 14px;
                    cursor: pointer;
                    transition: transform 0.1s, opacity 0.2s;
                " onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'" ontouchstart="this.style.transform='scale(0.95)'" ontouchend="this.style.transform='scale(1)'">${dayEntries.length > 0 ? '再写一篇' : '生成这一天的日记'}</button>
            </div>
        </div>
    `;
}

// 打开指定日期的日记详情（指定索引）
function openDiaryDetailForDateWithIndex(dateStr, index) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const entries = diaryData.diaries[diaryData.currentAssistantId]?.entries || [];
    const dayEntries = entries.filter(e => {
        const d = new Date(e.date);
        return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
    if (dayEntries.length > 0) {
        openDiaryDetailForDate(dateStr, dayEntries);
        // 跳转到指定索引
        if (index > 0 && index < dayEntries.length) {
            diaryDetailCurrentIndex = index;
            diaryData.currentDiaryId = dayEntries[index].id;
            updateDiaryDetailSlider();
        }
    }
}

// 切换自动写日记
function toggleDiaryAutoWrite() {
    const assistantId = diaryData.currentAssistantId;
    if (!assistantId) return;

    if (!diaryData.diaries[assistantId]) {
        diaryData.diaries[assistantId] = { entries: [], autoWrite: false };
    }

    diaryData.diaries[assistantId].autoWrite = !diaryData.diaries[assistantId].autoWrite;
    saveDiaryData();

    // 更新开关UI
    const autoSwitch = document.getElementById('diaryAutoSwitch');
    autoSwitch.classList.toggle('on', diaryData.diaries[assistantId].autoWrite);

    // 设置/取消定时任务
    setupDiaryAutoSchedule();
}

// 立即生成日记
async function generateDiaryNow() {
    const assistantId = diaryData.currentAssistantId;
    if (!assistantId) return;

    const assistant = appData.assistants.find(a => a.id === assistantId);
    if (!assistant) return;

    // 获取模型：助手默认模型 > 全局默认模型
    const assistantModel = assistant.providerId && assistant.modelId ? `${assistant.providerId}||${assistant.modelId}` : '';
    const globalModel = appData.settings.defaultModel;
    const modelValue = assistantModel || globalModel;
    if (!modelValue) {
        alert('请先在设置中选择默认模型');
        return;
    }

    const [providerId, modelId] = modelValue.split('||');
    const provider = appData.providers.find(p => p.id === providerId);
    if (!provider) {
        alert('找不到对应的供应商配置');
        return;
    }

    // 显示loading（浮动按钮已移除，此函数主要用于自动生成）
    try {
        // 获取微信聊天记录作为上下文
        const chatContext = getDiaryChatContext(assistantId);

        // 构建日记生成提示
        const today = new Date();
        const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

        const prompt = buildDiaryPrompt(assistant, chatContext, dateStr);

        // 调用API生成日记
        const response = await fetch(provider.baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            throw new Error('API请求失败: ' + response.status);
        }

        const data = await response.json();
        const diaryContent = data.choices?.[0]?.message?.content?.trim();

        if (!diaryContent) {
            throw new Error('生成日记内容为空');
        }

        // 保存日记
        const newEntry = {
            id: 'diary_' + Date.now(),
            date: today.toISOString(),
            content: diaryContent,
            weather: getRandomWeather()
        };

        if (!diaryData.diaries[assistantId]) {
            diaryData.diaries[assistantId] = { entries: [], autoWrite: false };
        }
        diaryData.diaries[assistantId].entries.push(newEntry);
        saveDiaryData();

        // 刷新日历和助手选择器
        renderDiaryCalendar();
        renderDiaryAssistantSelector();

        // 选中新日记的日期并显示
        const entryDate = new Date(newEntry.date);
        diarySelectedDate = `${entryDate.getFullYear()}-${entryDate.getMonth()}-${entryDate.getDate()}`;
        renderDiaryCalendar();
        renderDiaryContentArea();

        // 打开新日记详情
        openDiaryDetail(newEntry.id);

    } catch (e) {
        console.error('生成日记失败:', e);
        alert('生成日记失败: ' + e.message);
    }
}

// 获取微信聊天上下文用于日记（最近30条）
function getDiaryChatContext(assistantId) {
    const conv = wechatData.conversations?.[assistantId];
    if (!conv || !conv.messages || conv.messages.length === 0) {
        return '（最近没有和用户聊天）';
    }

    const assistant = appData.assistants.find(a => a.id === assistantId);
    const assistantName = assistant?.name || '我';

    // 取最近30条消息
    const recentMessages = conv.messages.slice(-30);

    let context = '最近和用户的聊天记录：\n\n';
    recentMessages.forEach(msg => {
        const speaker = msg.role === 'user' ? '用户' : assistantName;
        let content = msg.content || '';

        if (msg.type === 'image') {
            content = '[发送了一张图片]';
        } else if (msg.type === 'voice_message') {
            // voice_message: 直接使用转文字内容，不加前缀
        } else if (msg.type === 'transfer') {
            content = `[转账 ¥${msg.amount}]`;
        } else if (msg.type === 'transfer_receipt') {
            content = msg.action === 'accepted' ? `[收款 ¥${msg.amount}]` : `[拒收 ¥${msg.amount}]`;
        } else if (msg.type === 'pat_message') {
            content = ''; // pat_message: 跳过，节省token
        }

        // 过滤掉时间间隔标记（避免日记中出现"过了几天"等描述）
        content = content.replace(/\[距离上次对话[^\]]*\]/g, '').trim();

        if (content) {
            context += `${speaker}: ${content}\n`;
        }
    });

    return context;
}

// 获取指定日期的聊天上下文
function getDiaryChatContextForDate(assistantId, dateStr) {
    const conv = wechatData.conversations?.[assistantId];
    if (!conv || !conv.messages || conv.messages.length === 0) {
        return '（完全没有和用户聊过天）';
    }

    // 解析目标日期
    const [year, month, day] = dateStr.split('-').map(Number);
    const targetStart = new Date(year, month, day, 0, 0, 0);
    const targetEnd = new Date(year, month, day, 23, 59, 59);

    const assistant = appData.assistants.find(a => a.id === assistantId);
    const assistantName = assistant?.name || '我';

    // 筛选当天的消息
    const dayMessages = conv.messages.filter(msg => {
        if (!msg.timestamp) return false;
        const msgDate = typeof msg.timestamp === 'number' ? new Date(msg.timestamp) : new Date(msg.timestamp);
        return msgDate >= targetStart && msgDate <= targetEnd;
    });

    // 如果当天有消息，直接返回当天的上下文
    if (dayMessages.length > 0) {
        let context = `这一天（${year}年${month + 1}月${day}日）和用户的聊天记录：\n\n`;
        dayMessages.forEach(msg => {
            const speaker = msg.role === 'user' ? '用户' : assistantName;
            let content = msg.content || '';

            if (msg.type === 'image') {
                content = '[发送了一张图片]';
            } else if (msg.type === 'voice_message') {
                // voice_message: 直接使用转文字内容，不加前缀
            } else if (msg.type === 'transfer') {
                content = `[转账 ¥${msg.amount}]`;
            } else if (msg.type === 'transfer_receipt') {
                content = msg.action === 'accepted' ? `[收款 ¥${msg.amount}]` : `[拒收 ¥${msg.amount}]`;
            } else if (msg.type === 'pat_message') {
                content = ''; // pat_message: 跳过，节省token
            }

            // 过滤掉时间间隔标记
            content = content.replace(/\[距离上次对话[^\]]*\]/g, '').trim();

            if (content) {
                // 添加消息时间
                const msgDate = typeof msg.timestamp === 'number' ? new Date(msg.timestamp) : new Date(msg.timestamp);
                const timeStr = `${String(msgDate.getHours()).padStart(2, '0')}:${String(msgDate.getMinutes()).padStart(2, '0')}`;
                context += `[${timeStr}] ${speaker}: ${content}\n`;
            }
        });
        return context;
    }

    // 当天没有消息，查找最近一天有聊天的日期
    let lastChatDate = null;
    let lastChatMessages = [];

    // 遍历所有消息，找到目标日期之前最近的聊天日期
    for (let i = conv.messages.length - 1; i >= 0; i--) {
        const msg = conv.messages[i];
        if (!msg.timestamp) continue;
        const msgDate = typeof msg.timestamp === 'number' ? new Date(msg.timestamp) : new Date(msg.timestamp);

        // 只考虑目标日期之前的消息
        if (msgDate < targetStart) {
            if (!lastChatDate) {
                lastChatDate = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());
            }
            // 检查是否同一天
            const msgDay = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());
            if (msgDay.getTime() === lastChatDate.getTime()) {
                lastChatMessages.unshift(msg);
            } else {
                break; // 已经到了更早的一天，停止
            }
        }
    }

    if (!lastChatDate || lastChatMessages.length === 0) {
        return '（在这一天之前没有和用户聊过天）';
    }

    // 计算距离上次聊天多少天
    const daysDiff = Math.floor((targetStart - lastChatDate) / (1000 * 60 * 60 * 24));
    const lastChatDateStr = `${lastChatDate.getFullYear()}年${lastChatDate.getMonth() + 1}月${lastChatDate.getDate()}日`;

    let context = `【注意】这一天（${year}年${month + 1}月${day}日）没有和用户聊天，已经${daysDiff}天没有联系了。\n`;
    context += `以下是最近一次聊天（${lastChatDateStr}）的记录，供你参考：\n\n`;

    lastChatMessages.forEach(msg => {
        const speaker = msg.role === 'user' ? '用户' : assistantName;
        let content = msg.content || '';

        if (msg.type === 'image') {
            content = '[发送了一张图片]';
        } else if (msg.type === 'voice_message') {
            // voice_message: 直接使用转文字内容，不加前缀
        } else if (msg.type === 'transfer') {
            content = `[转账 ¥${msg.amount}]`;
        } else if (msg.type === 'transfer_receipt') {
            content = msg.action === 'accepted' ? `[收款 ¥${msg.amount}]` : `[拒收 ¥${msg.amount}]`;
        } else if (msg.type === 'pat_message') {
            content = ''; // pat_message: 跳过，节省token
        }

        // 过滤掉时间间隔标记
        content = content.replace(/\[距离上次对话[^\]]*\]/g, '').trim();

        if (content) {
            const msgDate = typeof msg.timestamp === 'number' ? new Date(msg.timestamp) : new Date(msg.timestamp);
            const timeStr = `${String(msgDate.getHours()).padStart(2, '0')}:${String(msgDate.getMinutes()).padStart(2, '0')}`;
            context += `[${timeStr}] ${speaker}: ${content}\n`;
        }
    });

    return context;
}

// 生成指定日期的日记
async function generateDiaryForDate(dateStr) {
    const assistantId = diaryData.currentAssistantId;
    if (!assistantId) return;

    const assistant = appData.assistants.find(a => a.id === assistantId);
    if (!assistant) return;

    // 获取模型：助手默认模型 > 全局默认模型
    const assistantModel = assistant.providerId && assistant.modelId ? `${assistant.providerId}||${assistant.modelId}` : '';
    const globalModel = appData.settings.defaultModel;
    const modelValue = assistantModel || globalModel;
    if (!modelValue) {
        alert('请先在设置中选择默认模型');
        return;
    }

    const [providerId, modelId] = modelValue.split('||');
    const provider = appData.providers.find(p => p.id === providerId);
    if (!provider) {
        alert('找不到对应的供应商配置');
        return;
    }

    // 解析日期
    const [year, month, day] = dateStr.split('-').map(Number);
    const targetDate = new Date(year, month, day);
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const dateDisplay = `${year}年${month + 1}月${day}日 ${weekDays[targetDate.getDay()]}`;

    // 显示loading
    const btn = document.getElementById('diaryGenerateBtn');
    const originalText = btn?.innerHTML;
    if (btn) {
        btn.innerHTML = '⏳ 生成中...';
        btn.disabled = true;
        btn.style.opacity = '0.7';
    }

    try {
        // 获取指定日期的聊天上下文
        const chatContext = getDiaryChatContextForDate(assistantId, dateStr);

        // 构建日记生成提示
        const prompt = buildDiaryPromptForDate(assistant, chatContext, dateDisplay);

        // 调用API生成日记
        const response = await fetch(provider.baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            throw new Error('API请求失败: ' + response.status);
        }

        const data = await response.json();
        const diaryContent = data.choices?.[0]?.message?.content?.trim();

        if (!diaryContent) {
            throw new Error('生成日记内容为空');
        }

        // 保存日记（使用指定日期）
        const newEntry = {
            id: 'diary_' + Date.now(),
            date: targetDate.toISOString(),
            content: diaryContent,
            weather: getRandomWeather()
        };

        if (!diaryData.diaries[assistantId]) {
            diaryData.diaries[assistantId] = { entries: [], autoWrite: false };
        }
        diaryData.diaries[assistantId].entries.push(newEntry);
        saveDiaryData();

        // 刷新日历和助手选择器
        renderDiaryCalendar();
        renderDiaryAssistantSelector();

        // 打开新日记详情
        openDiaryDetailForDate(dateStr, [newEntry]);

    } catch (e) {
        console.error('生成日记失败:', e);
        alert('生成日记失败: ' + e.message);
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    }
}

// 构建指定日期的日记生成提示
function buildDiaryPromptForDate(assistant, chatContext, dateStr) {
    const hasChat = !chatContext.includes('没有和用户聊天');
    return `你现在是"${assistant.name}"，请根据你的人设，写一篇${dateStr}的日记。

【你的人设】
${assistant.systemPrompt || '（无特别设定）'}

【当天的互动】
${chatContext}

【日记要求】
1. 以第一人称"我"来写
2. 这是${dateStr}的日记${hasChat ? '，结合当天的聊天经历来写' : '，虽然这天没有聊天，但可以写你这一天的想法、日常、或对用户的思念'}
3. 写出真情实感，符合你的性格特点
4. 可以写对用户的想法、期待、小心思等
5. 字数300-500字左右
6. 自然流畅，像真的日记一样
7. 不要在开头写日期！日期已经显示在标题中了，直接开始写日记正文

请直接输出日记内容，不要加标题、日期或额外格式。`;
}

// 构建日记生成提示
function buildDiaryPrompt(assistant, chatContext, dateStr) {
    return `你现在是"${assistant.name}"，请根据你的人设和最近与用户的互动，写一篇今天（${dateStr}）的日记。

【你的人设】
${assistant.systemPrompt || '（无特别设定）'}

【最近的互动】
${chatContext}

【日记要求】
1. 以第一人称"我"来写
2. 结合今天的日期和最近的互动经历
3. 写出真情实感，符合你的性格特点
4. 可以写对用户的想法、期待、小心思等
5. 字数300-500字左右
6. 自然流畅，像真的日记一样
7. 如果最近没有聊天记录，可以写你的日常想法和对用户的思念
8. 不要在开头写日期！日期已经显示在标题中了，直接开始写日记正文

请直接输出日记内容，不要加标题、日期或额外格式。`;
}

// 随机天气
function getRandomWeather() {
    const weathers = ['☀️ 晴', '⛅ 多云', '🌧️ 小雨', '🌤️ 晴转多云', '❄️ 雪', '🌈 雨后彩虹'];
    return weathers[Math.floor(Math.random() * weathers.length)];
}

// 日记详情页滑动相关变量
let diaryDetailEntries = [];
let diaryDetailCurrentIndex = 0;
let diaryDetailTouchStartX = 0;
let diaryDetailTouchEndX = 0;

// 打开指定日期的日记详情页（支持滑动切换多篇）
function openDiaryDetailForDate(dateStr, entries) {
    diaryDetailEntries = entries;
    diaryDetailCurrentIndex = 0;

    // 解析日期
    const [year, month, day] = dateStr.split('-').map(Number);
    const dateObj = new Date(year, month, day);
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const dateDisplay = `${year}年${month + 1}月${day}日 ${weekDays[dateObj.getDay()]}`;

    // 设置标题
    document.getElementById('diaryDetailTitle').textContent = dateDisplay;

    // 渲染滑动内容
    renderDiaryDetailSlider();

    // 设置当前日记ID（用于删除）
    diaryData.currentDiaryId = entries[0].id;

    openPage('diaryDetailPage');

    // 绑定滑动事件
    initDiaryDetailSwipe();
}

// 通过单个日记ID打开（兼容旧代码）
function openDiaryDetail(diaryId) {
    const diaryInfo = diaryData.diaries[diaryData.currentAssistantId];
    const entry = diaryInfo?.entries?.find(e => e.id === diaryId);
    if (!entry) return;

    // 找到这一天的所有日记
    const entryDate = new Date(entry.date);
    const dayEntries = diaryInfo.entries.filter(e => {
        const d = new Date(e.date);
        return d.getFullYear() === entryDate.getFullYear() &&
               d.getMonth() === entryDate.getMonth() &&
               d.getDate() === entryDate.getDate();
    });

    const dateStr = `${entryDate.getFullYear()}-${entryDate.getMonth()}-${entryDate.getDate()}`;
    openDiaryDetailForDate(dateStr, dayEntries);

    // 定位到指定的日记
    const idx = dayEntries.findIndex(e => e.id === diaryId);
    if (idx > 0) {
        diaryDetailCurrentIndex = idx;
        diaryData.currentDiaryId = dayEntries[idx].id;
        updateDiaryDetailSlider();
    }
}

// 渲染日记详情滑动内容
function renderDiaryDetailSlider() {
    const slider = document.getElementById('diaryDetailSlider');
    const indicator = document.getElementById('diaryPageIndicator');
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    // 生成每篇日记的HTML
    slider.innerHTML = diaryDetailEntries.map(entry => {
        const date = new Date(entry.date);
        const dateStr = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekDays[date.getDay()]}`;
        return `
            <div class="diary-detail-slide">
                <div class="diary-detail-date">${dateStr} ${entry.weather || ''}</div>
                <div class="diary-detail-text">${escapeHtml(entry.content)}</div>
            </div>
        `;
    }).join('');

    // 显示页码指示器（多篇时显示）
    if (diaryDetailEntries.length > 1) {
        indicator.style.display = 'block';
        indicator.textContent = `${diaryDetailCurrentIndex + 1}/${diaryDetailEntries.length}`;
    } else {
        indicator.style.display = 'none';
    }

    updateDiaryDetailSlider();
}

// 更新滑动位置
function updateDiaryDetailSlider() {
    const slider = document.getElementById('diaryDetailSlider');
    const indicator = document.getElementById('diaryPageIndicator');
    const prevBtn = document.getElementById('diaryNavPrev');
    const nextBtn = document.getElementById('diaryNavNext');

    slider.style.transform = `translateX(-${diaryDetailCurrentIndex * 100}%)`;

    if (diaryDetailEntries.length > 1) {
        indicator.textContent = `${diaryDetailCurrentIndex + 1}/${diaryDetailEntries.length}`;
        // PC端显示导航箭头
        prevBtn.style.display = diaryDetailCurrentIndex > 0 ? 'block' : 'none';
        nextBtn.style.display = diaryDetailCurrentIndex < diaryDetailEntries.length - 1 ? 'block' : 'none';
    } else {
        // 只有一篇时隐藏所有导航
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
    }

    // 更新当前日记ID
    diaryData.currentDiaryId = diaryDetailEntries[diaryDetailCurrentIndex].id;
}

// 初始化滑动事件
function initDiaryDetailSwipe() {
    const slider = document.getElementById('diaryDetailSlider');

    slider.addEventListener('touchstart', (e) => {
        diaryDetailTouchStartX = e.touches[0].clientX;
    }, { passive: true });

    slider.addEventListener('touchend', (e) => {
        diaryDetailTouchEndX = e.changedTouches[0].clientX;
        handleDiaryDetailSwipe();
    }, { passive: true });
}

// 处理滑动
function handleDiaryDetailSwipe() {
    const diff = diaryDetailTouchStartX - diaryDetailTouchEndX;
    const threshold = 50;

    if (diff > threshold && diaryDetailCurrentIndex < diaryDetailEntries.length - 1) {
        // 向左滑，下一篇
        diaryDetailCurrentIndex++;
        updateDiaryDetailSlider();
    } else if (diff < -threshold && diaryDetailCurrentIndex > 0) {
        // 向右滑，上一篇
        diaryDetailCurrentIndex--;
        updateDiaryDetailSlider();
    }
}

// PC端上一篇
function diaryDetailPrev() {
    if (diaryDetailCurrentIndex > 0) {
        diaryDetailCurrentIndex--;
        updateDiaryDetailSlider();
    }
}

// PC端下一篇
function diaryDetailNext() {
    if (diaryDetailCurrentIndex < diaryDetailEntries.length - 1) {
        diaryDetailCurrentIndex++;
        updateDiaryDetailSlider();
    }
}

// 关闭日记详情页
function closeDiaryDetailPage() {
    closePage('diaryDetailPage');
    // 刷新日历
    renderDiaryCalendar();
    renderDiaryContentArea();
}

// 删除日记
function deleteDiaryEntry() {
    if (!confirm('确定要删除这篇日记吗？')) return;

    const diaryInfo = diaryData.diaries[diaryData.currentAssistantId];
    if (diaryInfo) {
        diaryInfo.entries = diaryInfo.entries.filter(e => e.id !== diaryData.currentDiaryId);
        saveDiaryData();
    }

    // 更新当前日记列表
    diaryDetailEntries = diaryDetailEntries.filter(e => e.id !== diaryData.currentDiaryId);

    if (diaryDetailEntries.length === 0) {
        // 没有更多日记了，关闭详情页
        closeDiaryDetailPage();
    } else {
        // 还有日记，调整索引并刷新
        if (diaryDetailCurrentIndex >= diaryDetailEntries.length) {
            diaryDetailCurrentIndex = diaryDetailEntries.length - 1;
        }
        diaryData.currentDiaryId = diaryDetailEntries[diaryDetailCurrentIndex].id;
        renderDiaryDetailSlider();
    }

    // 刷新日历和内容区域
    renderDiaryCalendar();
    renderDiaryAssistantSelector();
}

// 设置自动日记定时
let diaryAutoTimer = null;
function setupDiaryAutoSchedule() {
    // 清除现有定时器
    if (diaryAutoTimer) {
        clearInterval(diaryAutoTimer);
    }

    // 每分钟检查一次是否到了22:00
    diaryAutoTimer = setInterval(() => {
        const now = new Date();
        if (now.getHours() === 22 && now.getMinutes() === 0) {
            // 遍历所有开启自动日记的助手
            Object.keys(diaryData.diaries).forEach(assistantId => {
                const info = diaryData.diaries[assistantId];
                if (info.autoWrite) {
                    // 检查今天是否已写过
                    const today = new Date().toDateString();
                    const hasToday = info.entries?.some(e => new Date(e.date).toDateString() === today);
                    if (!hasToday) {
                        generateDiaryForAssistant(assistantId);
                    }
                }
            });
        }
    }, 60000); // 每分钟检查
}

// 为指定助手生成日记（自动模式）
async function generateDiaryForAssistant(assistantId) {
    const assistant = appData.assistants.find(a => a.id === assistantId);
    if (!assistant) return;

    // 获取模型：助手默认模型 > 全局默认模型
    const assistantModel = assistant.providerId && assistant.modelId ? `${assistant.providerId}||${assistant.modelId}` : '';
    const globalModel = appData.settings.defaultModel;
    const modelValue = assistantModel || globalModel;
    if (!modelValue) return;

    const [providerId, modelId] = modelValue.split('||');
    const provider = appData.providers.find(p => p.id === providerId);
    if (!provider) return;

    try {
        const chatContext = getDiaryChatContext(assistantId);
        const today = new Date();
        const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
        const prompt = buildDiaryPrompt(assistant, chatContext, dateStr);

        const response = await fetch(provider.baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: 1000
            })
        });

        if (!response.ok) return;

        const data = await response.json();
        const diaryContent = data.choices?.[0]?.message?.content?.trim();
        if (!diaryContent) return;

        const newEntry = {
            id: 'diary_' + Date.now(),
            date: today.toISOString(),
            content: diaryContent,
            weather: getRandomWeather()
        };

        if (!diaryData.diaries[assistantId]) {
            diaryData.diaries[assistantId] = { entries: [], autoWrite: true };
        }
        diaryData.diaries[assistantId].entries.push(newEntry);
        saveDiaryData();

        console.log(`已为 ${assistant.name} 自动生成日记`);
    } catch (e) {
        console.error('自动生成日记失败:', e);
    }
}

// 页面加载时初始化日记定时器
document.addEventListener('DOMContentLoaded', () => {
    loadDiaryData();
    setupDiaryAutoSchedule();
});

