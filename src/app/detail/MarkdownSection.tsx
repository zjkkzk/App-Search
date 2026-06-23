// ─── README 渲染（Web）— iframe + marked + highlight.js ──────────────────────
// 注意：dangerouslySetInnerHTML 会剥离 <script> 标签，因此 Web 端使用 iframe
// 的 srcdoc 属性，iframe 拥有独立文档上下文，脚本可以正常执行。
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { README_CSS, buildReadmeJs } from './_readmeUtils';

interface Props {
  content: string;
  owner: string;
  repo: string;
}

export default function MarkdownSection({ content, owner, repo }: Props) {
  const [iframeHeight, setIframeHeight] = useState(200);
  const { width } = useWindowDimensions();

  if (!content) return null;

  const cleaned = content.replace(/^---[\s\S]*?---\r?\n?/, '').trim();
  if (!cleaned) return null;

  const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`;
  const escapedMd = cleaned
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/<\/(script|style)>/gi, '<\\/$1>');

  const js = buildReadmeJs(escapedMd, baseUrl);
  const fullHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css"><script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"><\\/script><script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\\/script><style>${README_CSS}</style></head><body><div id="md-content"></div><script>${js}<\\/script></body></html>`;

  // 监听 iframe 发来的高度消息
  const handleMessage = useCallback((e: MessageEvent) => {
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (data.type === 'height' && data.height > 0) {
        setIframeHeight(data.height + 20); // 加一点 padding
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 4 }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 10 }}>README</Text>
      {/* @ts-ignore — iframe 是 HTML 原生元素 */}
      <iframe
        srcDoc={fullHtml}
        style={{
          width: '100%',
          height: iframeHeight,
          border: 'none',
          borderRadius: 8,
        }}
        title="README"
        sandbox="allow-scripts allow-same-origin"
      />
    </View>
  );
}