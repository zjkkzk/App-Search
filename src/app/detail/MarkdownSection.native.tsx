// ─── README 渲染（Native: iOS / Android）— WebView + marked + highlight.js ──
import React, { useState } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { README_CSS, buildReadmeJs } from './_readmeUtils';

interface Props {
  content: string;
  owner: string;
  repo: string;
}

export default function MarkdownSection({ content, owner, repo }: Props) {
  const [webViewHeight, setWebViewHeight] = useState(200);
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

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 4 }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 10 }}>README</Text>
      <WebView
        source={{ html: fullHtml }}
        style={{ width: width - 64, height: webViewHeight }}
        scrollEnabled={false}
        javaScriptEnabled={true}
        originWhitelist={['*']}
        onMessage={(e: any) => {
          try {
            const data = JSON.parse(e.nativeEvent.data);
            if (data.type === 'height' && data.height > 0) {
              setWebViewHeight(data.height);
            }
          } catch { /* ignore */ }
        }}
        onError={() => {}}
      />
    </View>
  );
}