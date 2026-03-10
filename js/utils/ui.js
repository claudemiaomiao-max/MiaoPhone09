/**
 * utils/ui.js - 通用 UI 工具函数
 *
 * 暴露函数：showOverlay, closeOverlay, showModal, hideModal, escapeHtml, showWechatToast, downloadFile
 * 依赖：无（纯 DOM 操作）
 */

function showOverlay() {
    document.getElementById('overlay').classList.add('show');
}

function closeOverlay() {
    document.getElementById('overlay').classList.remove('show');
}

function showModal(modalId) {
    document.getElementById(modalId).classList.add('show');
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Toast 提示函数
function showWechatToast(message, type = 'info', duration = 2500) {
    // 移除已有的 toast
    const existingToast = document.querySelector('.wechat-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `wechat-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
