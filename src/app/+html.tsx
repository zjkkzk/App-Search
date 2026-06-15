import { ScrollViewStyleReset } from 'expo-router/html';

/**
 * 自定义 HTML shell，注入早期错误诊断脚本（临时调试用）
 * 此脚本在所有 defer JS 之前运行，可捕获最早期的错误
 */
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        {/* 注入最早期错误捕获，早于所有 defer 脚本 */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var errs = [];
            function show(msg, bg, top) {
              var el = document.createElement('div');
              el.style.cssText = 'position:fixed;' + top + ';left:0;right:0;padding:12px 16px;background:' + bg + ';color:#fff;z-index:9999999;font-size:12px;word-break:break-all;font-family:monospace;white-space:pre-wrap;max-height:50vh;overflow-y:auto;line-height:1.4';
              el.textContent = msg;
              if (document.body) document.body.appendChild(el);
              else document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(el); });
            }
            window.onerror = function(msg, src, line, col, err) {
              show('[JS Error]\\n' + msg + '\\n' + src + ':' + line + ':' + col + '\\n' + (err && err.stack || ''), '#c0392b', 'top:0');
              return false;
            };
            window.addEventListener('unhandledrejection', function(e) {
              var r = e.reason;
              show('[Promise Rejection]\\n' + (r && r.stack || r || '(unknown)'), '#e67e22', 'top:0');
            });
            window.__diagLog = function(msg) {
              show('[Debug] ' + msg, '#2980b9', 'top:0');
            };
            // 5秒后检查 React 是否已挂载
            setTimeout(function() {
              var root = document.getElementById('root');
              if (!root || !root.firstElementChild) {
                show('[诊断] React 未挂载 — root 元素在 5s 后仍为空\\n请查看上方是否有 JS Error / Promise Rejection', '#16a085', 'bottom:0');
              }
            }, 5000);
          })();
        ` }} />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
