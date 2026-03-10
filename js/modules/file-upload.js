/**
 * 文件上传模块
 * 负责：文件/图片选择、压缩、预览、multimodal content 构建
 * 暴露函数：showUploadOptions, hideUploadOptions, selectFile, selectImage, capturePhoto,
 *          handleFileSelect, compressImageForChat, processFile, renderFilePreview,
 *          removeFile, clearPendingFiles, buildMultimodalContent,
 *          showImagePreview, hideImagePreview, showAttachmentPreview, showWechatImagePreview
 * 依赖：appData(data.js), wechatData(微信模块)
 */

// ==================== 文件上传功能 ====================
let pendingFiles = []; // 存储待发送的文件
let currentUploadMode = 'api'; // 当前上传模式：api 或 wechat

function showUploadOptions(mode) {
    currentUploadMode = mode;
    document.getElementById('uploadOptionsOverlay').style.display = 'block';
    document.getElementById('uploadOptionsModal').style.display = 'block';
}

function hideUploadOptions() {
    document.getElementById('uploadOptionsOverlay').style.display = 'none';
    document.getElementById('uploadOptionsModal').style.display = 'none';
}

function selectFile() {
    hideUploadOptions();
    document.getElementById('fileInput').click();
}

function selectImage() {
    hideUploadOptions();
    document.getElementById('imageInput').click();
}

function capturePhoto() {
    hideUploadOptions();
    document.getElementById('cameraInput').click();
}

async function handleFileSelect(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
        try {
            const fileData = await processFile(file);
            pendingFiles.push(fileData);
        } catch (err) {
            console.error('文件处理失败:', err);
            alert('文件处理失败: ' + file.name);
        }
    }

    renderFilePreview();
    event.target.value = ''; // 清空input以便重复选择
}

// 图片压缩函数（自适应压缩，目标大小300KB以内，已满足条件的不压缩）
function compressImageForChat(file, maxSize = 1600, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const TARGET_SIZE = 500 * 1024; // 目标500KB，小于此值不压缩

        // 如果文件已经小于目标大小，直接转为base64返回
        if (file.size <= TARGET_SIZE) {
            const reader = new FileReader();
            reader.onload = (e) => {
                console.log(`图片无需压缩: ${(file.size/1024).toFixed(1)}KB`);
                resolve(e.target.result);
            };
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsDataURL(file);
            return;
        }

        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            const originalWidth = img.width;
            const originalHeight = img.height;
            let width = img.width;
            let height = img.height;

            // 计算缩放比例（保持最长边不超过maxSize）
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } else {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            // 第一次压缩
            let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
            let compressedSize = Math.round(compressedDataUrl.length * 0.75);

            // 如果还是太大，逐步降低质量再压缩
            let currentQuality = quality;
            while (compressedSize > TARGET_SIZE && currentQuality > 0.3) {
                currentQuality -= 0.1;
                compressedDataUrl = canvas.toDataURL('image/jpeg', currentQuality);
                compressedSize = Math.round(compressedDataUrl.length * 0.75);
            }

            // 如果降低质量还不够，缩小尺寸
            if (compressedSize > TARGET_SIZE && (width > 1200 || height > 1200)) {
                const scale = 0.7;
                width = Math.round(width * scale);
                height = Math.round(height * scale);
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                compressedSize = Math.round(compressedDataUrl.length * 0.75);
            }

            const originalSize = file.size;
            console.log(`图片压缩: ${(originalSize/1024).toFixed(1)}KB → ${(compressedSize/1024).toFixed(1)}KB (${originalWidth}x${originalHeight} → ${width}x${height}, 质量${Math.round(currentQuality*100)}%)`);

            URL.revokeObjectURL(objectUrl);
            resolve(compressedDataUrl);
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('图片加载失败'));
        };

        img.src = objectUrl;
    });
}

async function processFile(file) {
    const isImage = file.type.startsWith('image/');
    const ext = file.name.split('.').pop().toLowerCase();

    // 判断是否是文本文件
    const textExtensions = ['txt', 'md', 'py', 'js', 'html', 'css', 'json', 'xml', 'yaml', 'yml', 'ts', 'jsx', 'tsx', 'vue', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'sh', 'bat', 'sql', 'csv'];
    const isTextFile = textExtensions.includes(ext) || file.type.startsWith('text/');

    // 获取media_type
    let mediaType = file.type;
    if (!mediaType && isImage) {
        const typeMap = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp'
        };
        mediaType = typeMap[ext] || 'image/jpeg';
    }

    // 读取base64（图片会先压缩）
    let base64Promise;
    if (isImage) {
        // 图片：压缩后转base64（最大1920px，质量0.85）
        base64Promise = compressImageForChat(file, 1920, 0.85);
    } else {
        // 非图片：直接读取base64
        base64Promise = new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // 读取文本内容（用于文本文件）
    const textPromise = isTextFile ? new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    }) : Promise.resolve(null);

    const [base64Data, textContent] = await Promise.all([base64Promise, textPromise]);

    // 压缩后的图片统一用 image/jpeg 类型
    const finalMediaType = isImage ? 'image/jpeg' : mediaType;

    return {
        name: file.name,
        type: file.type,
        mediaType: finalMediaType,
        size: file.size,
        isImage: isImage,
        isTextFile: isTextFile,
        base64: base64Data, // data:xxx;base64,xxx 格式
        base64Data: base64Data.split(',')[1], // 纯base64数据
        textContent: textContent // 文本文件的内容
    };
}

function renderFilePreview() {
    // 根据当前模式选择正确的预览区域
    const previewAreaId = currentUploadMode === 'wechat' ? 'wechatFilePreviewArea' : 'filePreviewArea';
    const previewArea = document.getElementById(previewAreaId);

    // 同时更新两个预览区域（防止切换模式时数据残留）
    const apiPreview = document.getElementById('filePreviewArea');
    const wechatPreview = document.getElementById('wechatFilePreviewArea');

    if (pendingFiles.length === 0) {
        if (apiPreview) { apiPreview.style.display = 'none'; apiPreview.innerHTML = ''; }
        if (wechatPreview) { wechatPreview.style.display = 'none'; wechatPreview.innerHTML = ''; }
        return;
    }

    const previewHtml = pendingFiles.map((file, index) => {
        if (file.isImage) {
            return `
                <div class="file-preview-item">
                    <img src="${file.base64}" alt="${file.name}">
                    <button class="file-remove-btn" onclick="removeFile(${index})">×</button>
                </div>
            `;
        } else {
            return `
                <div class="file-preview-item file-preview-doc">
                    <div class="file-icon">📄</div>
                    <div class="file-name">${file.name}</div>
                    <button class="file-remove-btn" onclick="removeFile(${index})">×</button>
                </div>
            `;
        }
    }).join('');

    // 只显示当前模式对应的预览区域
    if (currentUploadMode === 'wechat') {
        if (wechatPreview) { wechatPreview.style.display = 'flex'; wechatPreview.innerHTML = previewHtml; }
        if (apiPreview) { apiPreview.style.display = 'none'; apiPreview.innerHTML = ''; }
    } else {
        if (apiPreview) { apiPreview.style.display = 'flex'; apiPreview.innerHTML = previewHtml; }
        if (wechatPreview) { wechatPreview.style.display = 'none'; wechatPreview.innerHTML = ''; }
    }
}

function removeFile(index) {
    pendingFiles.splice(index, 1);
    renderFilePreview();
}

function clearPendingFiles() {
    pendingFiles = [];
    renderFilePreview();
}

// 构建包含文件的消息内容（OpenAI兼容multimodal格式）
// 注意：text 放前面，image_url 放后面（兼容更多第三方API）
function buildMultimodalContent(text, files) {
    if (!files || files.length === 0) {
        return text;
    }

    const content = [];

    // 构建文本内容（包含文本文件的实际内容）
    let textParts = [];

    // 添加文本文件的内容
    const textFiles = files.filter(f => f.isTextFile && f.textContent);
    if (textFiles.length > 0) {
        for (const file of textFiles) {
            textParts.push(`=== 文件: ${file.name} ===\n${file.textContent}\n=== 文件结束 ===`);
        }
    }

    // 添加非文本非图片文件的说明（如PDF等）
    const otherFiles = files.filter(f => !f.isImage && !f.isTextFile);
    if (otherFiles.length > 0) {
        const fileList = otherFiles.map(f => `[文件: ${f.name} - 无法读取内容]`).join('\n');
        textParts.push(fileList);
    }

    // 添加用户输入的文本
    if (text) {
        textParts.push(text);
    }

    // 如果只有图片没有文本，添加默认提示
    const finalText = textParts.length > 0 ? textParts.join('\n\n') : '请查看图片';

    // 先添加文本（放在前面）
    content.push({
        type: 'text',
        text: finalText
    });

    // 再添加图片（放在后面，使用OpenAI兼容格式）
    for (const file of files) {
        if (file.isImage) {
            content.push({
                type: 'image_url',
                image_url: {
                    url: file.base64,  // data:image/xxx;base64,xxx 完整格式
                    detail: 'auto'     // 一些API需要这个参数
                }
            });
        }
    }

    return content;
}

// 图片预览功能
function showImagePreview(src) {
    const modal = document.getElementById('imagePreviewModal');
    const img = document.getElementById('imagePreviewImg');
    img.src = src;
    modal.classList.add('show');
}

function hideImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    modal.classList.remove('show');
}

// 从消息附件中显示图片预览
function showAttachmentPreview(imgElement) {
    const msgId = imgElement.dataset.msgId;
    const attIdx = parseInt(imgElement.dataset.attIdx);

    // 从API模式消息中查找
    const messages = appData.messages[appData.currentConversationId] || [];
    const msg = messages.find(m => m.id === msgId);
    if (msg && msg.attachments && msg.attachments[attIdx]) {
        showImagePreview(msg.attachments[attIdx].preview);
    }
}

// 从微信消息中显示图片预览
function showWechatImagePreview(msgId) {
    const conv = wechatData.conversations[wechatData.currentAssistantId];
    if (!conv) return;

    // 在正式消息和暂存消息中查找
    let msg = conv.messages.find(m => m.id === msgId);
    if (!msg) {
        msg = wechatData.pendingMessages.find(m => m.id === msgId);
    }

    if (msg && msg.type === 'image' && msg.content) {
        showImagePreview(msg.content);
    }
}
