/**
 * utils/markdown.js - Markdown 渲染和消息内容格式化
 *
 * 暴露函数：formatMessageContent, copyCodeBlock
 * 依赖：escapeHtml (ui.js), stripInterjectionsAlways (modules/tts.js)
 */

function formatMessageContent(content, useMarkdown = true) {
    if (!content) return '';
    // 去除拟声词标签，避免显示给用户
    content = stripInterjectionsAlways(content);

    // 使用 marked.js 进行 Markdown 渲染
    if (useMarkdown && typeof marked !== 'undefined') {
        try {
            // 配置 marked
            marked.setOptions({
                breaks: true,      // 自动换行
                gfm: true,         // 支持 GitHub Flavored Markdown
                sanitize: false,   // 不过滤 HTML（已通过其他方式处理安全问题）
                smartLists: true,  // 智能列表
                smartypants: false // 不自动替换引号等
            });

            let html = marked.parse(content);

            // 处理代码块，添加复制按钮
            html = html.replace(/<pre><code(.*?)>([\s\S]*?)<\/code><\/pre>/g,
                '<div class="code-block-wrapper"><pre><code$1>$2</code></pre><button class="code-copy-btn" onclick="copyCodeBlock(this)">复制</button></div>');

            return html;
        } catch (e) {
            console.error('Markdown 渲染失败:', e);
        }
    }

    // 降级：基本格式化
    let html = escapeHtml(content);
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

// 复制代码块
function copyCodeBlock(btn) {
    const codeEl = btn.previousElementSibling.querySelector('code');
    if (codeEl) {
        navigator.clipboard.writeText(codeEl.textContent).then(() => {
            const originalText = btn.textContent;
            btn.textContent = '已复制';
            setTimeout(() => btn.textContent = originalText, 1500);
        });
    }
}
