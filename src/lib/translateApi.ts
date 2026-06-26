/**
 * 翻译 API 封装
 * - 通过 Supabase Edge Function 调用百度翻译
 * - 内存缓存 + AsyncStorage 持久化，相同文本不重复请求
 */
import { supabase } from '@/client/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 内存缓存：key = "from|to|text"
const memCache = new Map<string, string>();
const STORAGE_KEY = 'oas_translate_cache';

/** 从 AsyncStorage 加载持久化缓存 */
let cacheLoaded = false;
async function ensureCacheLoaded() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const obj: Record<string, string> = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj)) memCache.set(k, v);
    }
  } catch { /* 忽略 */ }
}

/** 持久化内存缓存（异步，不阻塞） */
function persistCache() {
  const obj: Record<string, string> = {};
  memCache.forEach((v, k) => { obj[k] = v; });
  // 最多保留 2000 条
  const keys = Object.keys(obj);
  if (keys.length > 2000) {
    const trimmed: Record<string, string> = {};
    keys.slice(-2000).forEach((k) => { trimmed[k] = obj[k]; });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)).catch(() => {});
  } else {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(obj)).catch(() => {});
  }
}

/**
 * 翻译单段文本
 * @param text  原文（最多 6000 字符）
 * @param to    目标语言：'zh' | 'en'
 * @returns     译文，失败时返回原文
 */
export async function translateText(text: string, to: 'zh' | 'en'): Promise<string> {
  if (!text?.trim()) return text;

  await ensureCacheLoaded();

  const cacheKey = `${to}|${text}`;
  const cached = memCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const { data, error } = await supabase.functions.invoke('text-translation', {
      body: { q: text, from: 'auto', to },
    });
    if (error) throw error;
    if (data?.error_code) throw new Error(`API error ${data.error_code}`);

    const result: string = (data?.result?.trans_result ?? [])
      .map((r: { dst: string }) => r.dst)
      .join('\n') || text;

    memCache.set(cacheKey, result);
    persistCache();
    return result;
  } catch {
    return text; // 失败时降级返回原文
  }
}

/**
 * 批量翻译（合并请求，减少 API 调用次数）
 * @param texts  原文数组
 * @param to     目标语言
 * @returns      译文数组，顺序与原文一一对应
 */
export async function translateBatch(texts: string[], to: 'zh' | 'en'): Promise<string[]> {
  if (!texts.length) return texts;
  await ensureCacheLoaded();

  // 找出未缓存的条目
  const uncached: { idx: number; text: string }[] = [];
  const results = texts.map((t, idx) => {
    const key = `${to}|${t}`;
    const cached = memCache.get(key);
    if (cached !== undefined) return cached;
    uncached.push({ idx, text: t });
    return null;
  });

  if (!uncached.length) return results as string[];

  // 按换行拼接批量请求（最大 6000 字符）
  const batches: typeof uncached[] = [];
  let current: typeof uncached = [];
  let len = 0;
  for (const item of uncached) {
    if (len + item.text.length > 5500 && current.length) {
      batches.push(current);
      current = [];
      len = 0;
    }
    current.push(item);
    len += item.text.length + 1;
  }
  if (current.length) batches.push(current);

  for (const batch of batches) {
    try {
      const combined = batch.map((b) => b.text).join('\n');
      const { data, error } = await supabase.functions.invoke('text-translation', {
        body: { q: combined, from: 'auto', to },
      });
      if (error || data?.error_code) throw new Error('batch translate failed');

      const translated: string[] = (data?.result?.trans_result ?? []).map(
        (r: { dst: string }) => r.dst
      );

      batch.forEach((item, i) => {
        const dst = translated[i] ?? item.text;
        results[item.idx] = dst;
        memCache.set(`${to}|${item.text}`, dst);
      });
      persistCache();
    } catch {
      // 失败降级返回原文
      batch.forEach((item) => { results[item.idx] = item.text; });
    }
  }

  return results as string[];
}

/** 清除翻译缓存 */
export async function clearTranslationCache() {
  memCache.clear();
  cacheLoaded = false;
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

// ─── Markdown-aware 翻译（分块分段方案）────────────────────────────────────
//
// 旧方案（PUA 占位符）的问题：百度翻译 API 可能删除或转义 \uE000 等私有区字符，
// 导致占位符无法还原，Markdown 结构仍然被破坏。
//
// 新方案：完全不依赖占位符，改用「块级分离 + 行内区间分段」：
//   1. 块级分离 — 将 Markdown 分成「保留块」（代码块/HTML/空行/表格分隔线）
//                 和「翻译段」（文字行、标题、列表、blockquote 等）
//   2. 行内区间 — 对每个翻译行，用正则找出行内不可翻译区间（行内代码、
//                 HTML 标签、图片、链接 URL、裸 URL）
//   3. 分片翻译 — 只翻译纯文字片段，translateBatch 批量请求减少 API 调用
//   4. 原样重组 — 把翻译结果按原始索引填回，保留块一字不动地拼回
//
// 这样翻译 API 永远只收到纯文字，彻底避免破坏 Markdown / HTML 结构。

// ──────────────────────────────────────────────────────────────────────────────
// 工具：区间合并
// ──────────────────────────────────────────────────────────────────────────────
function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

// ──────────────────────────────────────────────────────────────────────────────
// 行内分段：找出一行内不可翻译的区间，返回片段数组
// ──────────────────────────────────────────────────────────────────────────────
interface Segment { text: string; translate: boolean }

function splitLineToSegments(line: string): Segment[] {
  const ranges: [number, number][] = [];

  const scan = (re: RegExp) => {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(line)) !== null) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  };

  // 行内代码 `...`
  scan(/`[^`]+`/g);
  // HTML 开标签（含属性，避免 height→高度）
  scan(/<[a-zA-Z][^>]*\/?>/g);
  // HTML 闭合标签
  scan(/<\/[a-zA-Z][^>]*>/g);
  // HTML 注释
  scan(/<!--[\s\S]*?-->/g);
  // Markdown 图片 ![alt](url) — 整体保护（含括号/路径）
  scan(/!\[[^\]]*\]\([^)]*\)/g);
  // Markdown 链接 [text](url) — 只保护 (url) 部分
  //   精确定位 url 的起止位置（text 允许翻译）
  {
    const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(line)) !== null) {
      // url 从 '[' + text + '](' 之后开始
      const urlStart = m.index + 1 + m[1].length + 2;
      const urlEnd   = urlStart + m[2].length;
      ranges.push([urlStart, urlEnd]);
    }
  }
  // 裸 URL（http/https，不在已有保护区间内）
  scan(/https?:\/\/[^\s)>\]"'`]+/g);

  const merged = mergeRanges(ranges);
  const segments: Segment[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (pos < s) segments.push({ text: line.slice(pos, s), translate: true });
    segments.push({ text: line.slice(s, e), translate: false });
    pos = e;
  }
  if (pos < line.length) segments.push({ text: line.slice(pos), translate: true });
  if (!segments.length)  segments.push({ text: line, translate: true });

  return segments;
}

// ──────────────────────────────────────────────────────────────────────────────
// 块级分离：把 Markdown 拆成「保留块」和「翻译行数组」
// ──────────────────────────────────────────────────────────────────────────────
interface MarkdownBlock {
  // raw=true  → 整行原样输出，不翻译
  // raw=false → 需对该行的各片段翻译
  lines: string[];
  raw: boolean;
}

function splitToBlocks(md: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const rawLines = md.split('\n');
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // ── 围栏代码块 ``` 或 ~~~（完整保留，含结束围栏）
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const chunk: string[] = [line];
      i++;
      while (i < rawLines.length) {
        chunk.push(rawLines[i]);
        if (rawLines[i].trimEnd() === fence || rawLines[i].startsWith(fence)) {
          i++;
          break;
        }
        i++;
      }
      blocks.push({ lines: chunk, raw: true });
      continue;
    }

    // ── 缩进代码行（4 空格 / Tab）
    if (/^(?: {4}|\t)/.test(line)) {
      blocks.push({ lines: [line], raw: true });
      i++;
      continue;
    }

    // ── 纯 HTML 块级标签行
    if (/^\s*<[a-zA-Z!]/.test(line)) {
      blocks.push({ lines: [line], raw: true });
      i++;
      continue;
    }

    // ── 表格分隔行（|---|---| 或 :---: 等）
    if (/^\s*\|?[\s:]*-{2,}[\s:]*[|\s:|-]*$/.test(line) && line.trim().length > 0) {
      blocks.push({ lines: [line], raw: true });
      i++;
      continue;
    }

    // ── Markdown 参考链接定义 [id]: url
    if (/^\s*\[[^\]]+\]:\s*\S/.test(line)) {
      blocks.push({ lines: [line], raw: true });
      i++;
      continue;
    }

    // ── Front-matter（文件开头 ---）
    if (i === 0 && line.trim() === '---') {
      const chunk: string[] = [line];
      i++;
      while (i < rawLines.length && rawLines[i].trim() !== '---') {
        chunk.push(rawLines[i++]);
      }
      if (i < rawLines.length) chunk.push(rawLines[i++]);
      blocks.push({ lines: chunk, raw: true });
      continue;
    }

    // ── 空行（保留，不翻译）
    if (!line.trim()) {
      blocks.push({ lines: [line], raw: true });
      i++;
      continue;
    }

    // ── 普通文字行（标题、段落、列表项、blockquote 等）→ 翻译
    blocks.push({ lines: [line], raw: false });
    i++;
  }

  return blocks;
}

// ──────────────────────────────────────────────────────────────────────────────
// 主入口：translateMarkdown
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 翻译 Markdown 文本，保护语法结构，只翻译纯文字片段。
 *
 * 不依赖任何占位符机制，翻译 API 永远只收到纯文字字符串，
 * 彻底避免 HTML 属性名被翻译（height→高度）、代码块被翻译等问题。
 *
 * @param md  原始 Markdown
 * @param to  目标语言
 * @returns   结构完整的翻译后 Markdown，失败时降级返回原文
 */
export async function translateMarkdown(md: string, to: 'zh' | 'en'): Promise<string> {
  if (!md?.trim()) return md;

  try {
    const blocks = splitToBlocks(md);

    // ── 第一步：收集所有需要翻译的纯文字片段
    // segmentMap[blockIdx][lineIdx] = Segment[]
    // 同时把所有 translate:true 的片段文字顺序放入 toTranslateTexts
    type SegMap = Segment[][];
    const segMaps: (SegMap | null)[] = blocks.map(block => {
      if (block.raw) return null;
      return block.lines.map(line => splitLineToSegments(line));
    });

    const toTranslateTexts: string[] = [];
    const textIndex: Array<{ bi: number; li: number; si: number }> = [];

    segMaps.forEach((segMap, bi) => {
      if (!segMap) return;
      segMap.forEach((segs, li) => {
        segs.forEach((seg, si) => {
          if (seg.translate && seg.text.trim()) {
            textIndex.push({ bi, li, si });
            toTranslateTexts.push(seg.text);
          }
        });
      });
    });

    if (!toTranslateTexts.length) return md; // 无可翻译内容

    // ── 第二步：批量翻译
    const translated = await translateBatch(toTranslateTexts, to);

    // ── 第三步：把翻译结果填回 segMaps
    translated.forEach((dst, idx) => {
      const { bi, li, si } = textIndex[idx];
      const segMap = segMaps[bi];
      if (segMap) segMap[li][si] = { ...segMap[li][si], text: dst };
    });

    // ── 第四步：重组
    const resultLines: string[] = [];
    blocks.forEach((block, bi) => {
      const segMap = segMaps[bi];
      if (!segMap) {
        // 保留块：原样输出
        resultLines.push(...block.lines);
      } else {
        // 翻译块：把片段拼回行
        segMap.forEach(segs => {
          resultLines.push(segs.map(s => s.text).join(''));
        });
      }
    });

    return resultLines.join('\n');
  } catch {
    return md; // 任何异常均降级返回原文
  }
}
