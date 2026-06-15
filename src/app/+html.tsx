import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>开源应用商店</title>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            window.onerror = function(msg, src, line, col, err) {
              var el = document.createElement('div');
              el.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:12px;background:#c0392b;color:#fff;z-index:9999999;font-size:12px;word-break:break-all;font-family:monospace;white-space:pre-wrap';
              el.textContent = '[JS Error] ' + msg + '\\n' + src + ':' + line + '\\n' + (err && err.stack || '');
              document.body ? document.body.appendChild(el) : document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(el); });
              return false;
            };
            window.addEventListener('unhandledrejection', function(e) {
              var el = document.createElement('div');
              el.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:12px;background:#e67e22;color:#fff;z-index:9999999;font-size:12px;word-break:break-all;font-family:monospace;white-space:pre-wrap';
              el.textContent = '[Unhandled Promise] ' + ((e.reason && e.reason.stack) || e.reason || '');
              document.body ? document.body.appendChild(el) : document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(el); });
            });
            setTimeout(function() {
              var root = document.getElementById('root');
              if (!root || !root.firstElementChild) {
                var el = document.createElement('div');
                el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:12px;background:#16a085;color:#fff;z-index:9999998;font-size:12px;font-family:monospace';
                el.textContent = '[诊断] 5s 后 React 仍未挂载，请查看上方错误信息';
                document.body.appendChild(el);
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
