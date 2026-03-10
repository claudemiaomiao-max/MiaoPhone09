/**
 * utils/image.js - 图片压缩工具
 *
 * 暴露函数：compressImage
 * 依赖：无（纯函数）
 */

function compressImage(file, maxSizeKB = 200, maxWidth = 400) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const originalBase64 = e.target.result;
            const originalSizeKB = Math.round(originalBase64.length * 0.75 / 1024);

            // 如果文件已经小于目标大小，直接返回原始数据
            if (originalSizeKB <= maxSizeKB) {
                console.log(`图片无需压缩: ${originalSizeKB}KB <= ${maxSizeKB}KB`);
                resolve(originalBase64);
                return;
            }

            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const originalWidth = img.width;
                const originalHeight = img.height;
                let width = img.width;
                let height = img.height;

                // 缩放
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // 压缩质量
                let quality = 0.9;
                let result = canvas.toDataURL('image/jpeg', quality);

                // 如果还是太大，继续降低质量
                while (result.length * 0.75 > maxSizeKB * 1024 && quality > 0.3) {
                    quality -= 0.1;
                    result = canvas.toDataURL('image/jpeg', quality);
                }

                const finalSizeKB = Math.round(result.length * 0.75 / 1024);
                console.log(`图片压缩: ${originalSizeKB}KB → ${finalSizeKB}KB (${originalWidth}x${originalHeight} → ${Math.round(width)}x${Math.round(height)}, 质量${Math.round(quality*100)}%)`);
                resolve(result);
            };
            img.src = originalBase64;
        };
        reader.readAsDataURL(file);
    });
}
