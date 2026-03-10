/**
 * utils/time.js - 时间格式化工具函数
 *
 * 暴露函数：formatDate, formatTime, formatTimeShort, formatWechatDate, getTimeOfDayGreeting
 * 依赖：无（纯函数）
 */

function formatDate(isoString) {
    const date = new Date(isoString);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatTime(isoString) {
    const date = new Date(isoString);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const sec = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${sec}`;
}

function formatTimeShort(isoString) {
    const date = new Date(isoString);
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${min}`;
}

function formatWechatDate(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const timeStr = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

    // 今天：只显示时间
    if (date.toDateString() === now.toDateString()) {
        return timeStr;
    }

    // 昨天
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return `昨天 ${timeStr}`;
    }

    // 本周内（2-6天前）：星期X HH:MM
    const daysDiff = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
    if (daysDiff < 7) {
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        return `${weekdays[date.getDay()]} ${timeStr}`;
    }

    // 同年
    if (date.getFullYear() === now.getFullYear()) {
        return `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
    }

    // 跨年
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
}

// 获取时段问候语
function getTimeOfDayGreeting(date = new Date()) {
    const hour = date.getHours();
    if (hour >= 0 && hour < 5) return '凌晨';
    if (hour >= 5 && hour < 9) return '早上';
    if (hour >= 9 && hour < 13) return '上午';
    if (hour >= 13 && hour < 18) return '下午';
    if (hour >= 18 && hour < 24) return '晚上';
    return '现在';
}
