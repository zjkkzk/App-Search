// ─── README 渲染 — react-native-marked useMarkdown 钩子（纯 JS，全平台）────
// 关键：使用 useMarkdown 钩子直接获取 ReactNode[]，渲染在普通 View 中，
// 避免 FlatList 嵌套 ScrollView 导致的虚拟化冲突、加载不完整和滚动卡死。
import React from 'react';
import { View, Text } from 'react-native';
import { useMarkdown, type MarkedStyles } from 'react-native-marked';

interface Props {
  content: string;
  owner: string;
  repo: string;
}

const styles: MarkedStyles = {
  h1: { fontSize: 24, fontWeight: '700', borderBottomWidth: 1, borderBottomColor: '#d8dee4', paddingBottom: 7, marginBottom: 12, marginTop: 20, color: '#1F2328' },
  h2: { fontSize: 20, fontWeight: '600', borderBottomWidth: 1, borderBottomColor: '#d8dee4', paddingBottom: 6, marginBottom: 10, marginTop: 20, color: '#1F2328' },
  h3: { fontSize: 17, fontWeight: '600', marginBottom: 8, marginTop: 16, color: '#1F2328' },
  h4: { fontSize: 15, fontWeight: '600', marginBottom: 6, marginTop: 14, color: '#1F2328' },
  h5: { fontSize: 14, fontWeight: '600', marginBottom: 4, marginTop: 12, color: '#1F2328' },
  h6: { fontSize: 13, fontWeight: '600', color: '#656d76', marginBottom: 4, marginTop: 10 },
  text: { fontSize: 14, lineHeight: 22, color: '#1F2328' },
  link: { color: '#0969da' },
  blockquote: { borderLeftWidth: 3, borderLeftColor: '#d8dee4', paddingLeft: 12, marginBottom: 12 },
  code: { backgroundColor: '#f6f8fa', borderRadius: 6, padding: 12, marginBottom: 10 },
  codespan: { backgroundColor: 'rgba(175,184,193,0.2)', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2, fontFamily: 'monospace', fontSize: 12, color: '#1F2328' },
  hr: { borderTopWidth: 1, borderTopColor: '#d8dee4', marginVertical: 20 },
  image: { resizeMode: 'contain' },
  table: { borderWidth: 1, borderColor: '#d8dee4', borderRadius: 6, marginBottom: 10 },
  tableCell: { borderWidth: 0.5, borderColor: '#d8dee4', padding: 8 },
  tableRow: { borderBottomWidth: 0.5, borderBottomColor: '#d8dee4' },
  li: { fontSize: 14, lineHeight: 22, color: '#1F2328', marginBottom: 2 },
  paragraph: { marginBottom: 10 },
  em: { fontStyle: 'italic' },
  strong: { fontWeight: '700' },
  strikethrough: { textDecorationLine: 'line-through', color: '#656d76' },
};

export default function MarkdownSection({ content, owner, repo }: Props) {
  const cleaned = (content || '').replace(/^---[\s\S]*?---\r?\n?/, '').trim();
  const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`;

  // useMarkdown 必须在顶层调用（React Hook 规则）
  const elements = useMarkdown(cleaned, { baseUrl, styles });

  if (!content || !cleaned) return null;

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 4 }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 10 }}>README</Text>
      {elements}
    </View>
  );
}