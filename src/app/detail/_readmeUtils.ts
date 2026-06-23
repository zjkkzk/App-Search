// ─── README 渲染公共工具：CSS、JS 生成器 ────────────────────────────────────────

export const README_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1F2328; padding: 0; margin: 0; word-wrap: break-word; overflow-wrap: break-word; }
  h1 { font-size: 1.8em; border-bottom: 1px solid #d8dee4; padding-bottom: .3em; margin: 24px 0 16px; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #d8dee4; padding-bottom: .3em; margin: 24px 0 16px; }
  h3 { font-size: 1.15em; margin: 24px 0 16px; }
  h4 { font-size: 1em; margin: 24px 0 16px; }
  p { margin: 0 0 12px; }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  img { max-width: 100%; height: auto; }
  code { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace; font-size: 85%; background: rgba(175,184,193,0.2); border-radius: 3px; padding: 2px 4px; }
  pre { background: #f6f8fa; border-radius: 6px; padding: 12px; overflow-x: auto; }
  pre code { background: none; padding: 0; font-size: 85%; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; display: block; overflow-x: auto; }
  th, td { border: 1px solid #d8dee4; padding: 6px 10px; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; }
  tr:nth-child(even) { background: #f8f9fa; }
  blockquote { border-left: 4px solid #d8dee4; margin: 0 0 12px; padding: 0 12px; color: #656d76; }
  ul, ol { padding-left: 24px; margin: 0 0 12px; }
  li { margin: 2px 0; }
  hr { border: none; border-top: 1px solid #d8dee4; margin: 24px 0; }
  .task-list-item { list-style: none; margin-left: -20px; }
  .markdown-alert { padding: 8px 16px; margin: 8px 0; border-left: 4px solid; border-radius: 4px; }
  .markdown-alert-note { background: #ddf4ff; border-color: #0969da; }
  .markdown-alert-tip { background: #dafbe1; border-color: #1a7f37; }
  .markdown-alert-warning { background: #fff8c5; border-color: #9a6700; }
  .markdown-alert-caution { background: #ffebe9; border-color: #cf222e; }
  .markdown-alert-title { font-weight: 600; margin-bottom: 4px; }
`;

export function buildReadmeJs(escapedMd: string, baseUrl: string): string {
  return `
    marked.setOptions({ gfm: true, breaks: false, highlight: function(code, lang) {
      if (lang && hljs.getLanguage(lang)) { try { return hljs.highlight(code, { language: lang }).value; } catch(e) {} }
      return hljs.highlightAuto(code).value;
    }});
    var md = \`${escapedMd}\`;
    md = md.replace(/\\]\\\\(((?!https?:\\/\\/)[^)]+)\\\\)/g, function(m, p1) { return '](' + '${baseUrl.replace(/'/g, "\\'")}' + p1 + ')'; });
    md = md.replace(/!\\[[^\\]]*\\]\\(((?!https?:\\/\\/)[^)]+)\\)/g, function(m, p1) { return m.replace(p1, '${baseUrl.replace(/'/g, "\\'")}' + p1); });
    document.getElementById('md-content').innerHTML = marked.parse(md);
    document.querySelectorAll('img').forEach(function(img) { if (/shields\\.io|badge\\.svg|badgen\\.net/i.test(img.src)) { img.src = img.src + (img.src.includes('?') ? '&format=png' : '?format=png'); } });
    setTimeout(function() {
      var h = document.getElementById('md-content').scrollHeight;
      var msg = JSON.stringify({ type: 'height', height: h });
      // Native WebView
      if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(msg); }
      // Web iframe
      else if (window.parent && window.parent !== window) { window.parent.postMessage(msg, '*'); }
    }, 300);
  `;
}

export function buildReadmeHtml(escapedMd: string, baseUrl: string): string {
  const js = buildReadmeJs(escapedMd, baseUrl);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css"><script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"><\\/script><script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\\/script><style>${README_CSS}</style></head><body><div id="md-content"></div><script>${js}<\\/script></body></html>`;
}