// ─── README 渲染 — WebView 方案（marked.js GFM + highlight.js 代码高亮）────────
// 效果与 GitHub 完全一致：标题、代码块语法高亮、表格、任务列表、Admonitions、徽章
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, Platform, ActivityIndicator, useWindowDimensions } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { buildReadmeHtml } from './_readmeUtils';

interface Props {
  content: string;
  owner: string;
  repo: string;
}

const MIN_HEIGHT = 120;

export default function MarkdownSection({ content, owner, repo }: Props) {
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [loaded, setLoaded] = useState(false);
  // 屏幕 padding 12*2 + 卡片内 padding 16*2 = 56，算出 WebView 精确像素宽
  const { width: windowWidth } = useWindowDimensions();
  const webViewWidth = windowWidth - 56;

  const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`;

  // ⚠️ html 与 source 都必须 memoize：
  // - html 变化 → WebView 重载 → 重新测高 → setHeight → re-render → 循环
  // - source 对象每次 render 新建引用 → WebView 同样判定变化并重载
  const html = useMemo(
    () => buildReadmeHtml(content, baseUrl, webViewWidth),
    [content, baseUrl, webViewWidth]
  );
  const source = useMemo(
    () => ({ html, baseUrl: `https://github.com/${owner}/${repo}` }),
    [html, owner, repo]
  );

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'height' && typeof data.height === 'number') {
        // 只允许高度增大，防止短暂重排导致高度减小再触发重载循环
        setHeight(prev => Math.max(prev, data.height + 24));
      }
    } catch { /* 忽略非 JSON 消息 */ }
  }, []);

  if (!content) return null;

  // ── Web 平台：iframe ──────────────────────────────────────────────────────
  if (Platform.OS === 'web') {
    return (
      <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 4 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 10 }}>README</Text>
        {/* @ts-ignore web only */}
        <iframe
          srcDoc={html}
          style={{ width: '100%', minHeight: 500, border: 'none', display: 'block' }}
          sandbox="allow-scripts allow-same-origin"
          onLoad={(e: any) => {
            const handler = (ev: MessageEvent) => {
              try {
                const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
                if (d?.type === 'height' && d.height > 0) {
                  e.target.style.height = (d.height + 24) + 'px';
                  window.removeEventListener('message', handler);
                }
              } catch { /* ignore */ }
            };
            window.addEventListener('message', handler);
          }}
        />
      </View>
    );
  }

  // ── Native 平台：WebView ──────────────────────────────────────────────────
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 4, width: '100%' }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 10 }}>README</Text>
      {!loaded && (
        <ActivityIndicator size="small" color="#0969da" style={{ marginVertical: 20 }} />
      )}
      <WebView
        source={source}
        style={{ height, width: webViewWidth, opacity: loaded ? 1 : 0 }}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        originWhitelist={['*']}
        onMessage={onMessage}
        onLoad={() => setLoaded(true)}
        mixedContentMode="always"
        javaScriptEnabled
        domStorageEnabled={false}
        cacheEnabled
        scalesPageToFit={false}
      />
    </View>
  );
}