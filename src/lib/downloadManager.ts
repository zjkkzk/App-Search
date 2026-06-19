/**
 * 下载管理器 v4 — IDM 风格
 *
 * 1. URL 解析：HEAD 跟随重定向取得直链 → 解决 GitHub 302 导致进度回调不触发
 * 2. 分片并行下载：文件 > 5 MB & 服务器支持 Range → 4 路并行 createDownloadResumable
 * 3. 降级单线程：Range 不支持 / 文件较小 → 单路直链下载
 * 4. SAF 保存：Android 完成后通过 StorageAccessFramework 写入公共 Downloads
 * 5. 顶层静态导入 expo-file-system/legacy（非懒加载），保证 SAF 选择器在手势同步上下文弹出
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as _FileSystem from 'expo-file-system/legacy';

const IS_WEB = Platform.OS === 'web';
const APP_FOLDER_NAME = '开源应用商店';
const SAF_URI_KEY = '@openappstore/saf_downloads_uri';
const MAX_CONCURRENT = 3;
const SEGMENT_COUNT = 4;
const SEGMENT_MIN_SIZE = 5 * 1024 * 1024; // 5 MB

function getFS(): typeof _FileSystem | null {
  return IS_WEB ? null : _FileSystem;
}

// ─── SAF ────────────────────────────────────────────────────────────────────
let _safDirUri: string | null | undefined = undefined;

async function loadSafUri(): Promise<string | null> {
  if (_safDirUri !== undefined) return _safDirUri;
  const stored = await AsyncStorage.getItem(SAF_URI_KEY).catch(() => null);
  const fs = getFS();
  if (!fs) { _safDirUri = null; return null; }
  if (stored) {
    try { await fs.StorageAccessFramework.readDirectoryAsync(stored); _safDirUri = stored; return stored; }
    catch { _safDirUri = null; await AsyncStorage.removeItem(SAF_URI_KEY).catch(() => null); }
  } else { _safDirUri = null; }
  return null;
}

export async function requestDownloadsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const fs = getFS();
  if (!fs) return false;
  try {
    const result = await fs.StorageAccessFramework.requestDirectoryPermissionsAsync(
      'content://com.android.externalstorage.documents/tree/primary%3ADownload'
    );
    if (!result.granted) return false;
    let finalUri = result.directoryUri;
    try {
      finalUri = await fs.StorageAccessFramework.makeDirectoryAsync(result.directoryUri, APP_FOLDER_NAME);
    } catch {
      try {
        const entries = await fs.StorageAccessFramework.readDirectoryAsync(result.directoryUri);
        const sub = entries.find((e: string) =>
          e.includes(encodeURIComponent(APP_FOLDER_NAME)) || e.endsWith(APP_FOLDER_NAME));
        if (sub) finalUri = sub;
      } catch { /* 退回 Download 根目录 */ }
    }
    _safDirUri = finalUri;
    await AsyncStorage.setItem(SAF_URI_KEY, finalUri).catch(() => null);
    return true;
  } catch { return false; }
}

export async function resetDownloadsPermission(): Promise<void> {
  _safDirUri = null;
  await AsyncStorage.removeItem(SAF_URI_KEY).catch(() => null);
}

export async function hasDownloadsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return (await loadSafUri()) !== null;
}

async function moveToSafDownloads(tempUri: string, filename: string): Promise<string> {
  const fs = getFS();
  if (!fs) return tempUri;
  try {
    const dirUri = await loadSafUri();
    if (!dirUri) return tempUri;
    const destUri = await fs.StorageAccessFramework.createFileAsync(dirUri, filename, getMimeType(filename));
    await fs.StorageAccessFramework.copyAsync({ from: tempUri, to: destUri });
    await fs.deleteAsync(tempUri, { idempotent: true }).catch(() => null);
    return destUri;
  } catch { return tempUri; }
}

// ─── 工具 ────────────────────────────────────────────────────────────────────
export function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.apk')) return 'application/vnd.android.package-archive';
  if (lower.endsWith('.ipa') || lower.endsWith('.pkg')) return 'application/octet-stream';
  if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (lower.endsWith('.msi')) return 'application/x-msi';
  if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (lower.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (lower.endsWith('.rpm')) return 'application/x-rpm';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'application/gzip';
  return 'application/octet-stream';
}

export function isInstallerFile(filename: string): boolean {
  return ['.apk','.ipa','.exe','.msi','.dmg','.pkg','.deb','.rpm','.appimage']
    .some((e) => filename.toLowerCase().endsWith(e));
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '';
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ─── 类型 ────────────────────────────────────────────────────────────────────
export type DownloadStatus = 'pending' | 'resolving' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface DownloadTask {
  id: string; url: string; filename: string; appId: number; appName: string;
  owner: string; repo: string; avatarUrl: string; version: string;
  status: DownloadStatus; progress: number; bytesWritten: number; totalBytes: number;
  speed: number; eta: number; localUri: string | null; error: string | null;
  createdAt: number; multiThreaded: boolean; activeChunks: number;
}

type ProgressCallback = (task: DownloadTask) => void;

// ─── 全局状态 ─────────────────────────────────────────────────────────────────
const tasks = new Map<string, DownloadTask>();
const subscribers = new Set<ProgressCallback>();
const lastProgressTime = new Map<string, { ts: number; bytes: number }>();
const segmentResumables = new Map<string, any[]>();

function genId(): string { return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
function notify(task: DownloadTask) { subscribers.forEach((cb) => cb({ ...task })); }
function flushQueue() {
  const active = [...tasks.values()].filter((t) => t.status === 'downloading' || t.status === 'resolving').length;
  if (active >= MAX_CONCURRENT) return;
  const next = [...tasks.values()].find((t) => t.status === 'pending');
  if (next) startTask(next.id);
}

// ─── URL 解析 ─────────────────────────────────────────────────────────────────
interface ServerInfo { finalUrl: string; contentLength: number; acceptsRanges: boolean; }

async function resolveUrl(url: string): Promise<ServerInfo> {
  try {
    const resp = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const cl = parseInt(resp.headers.get('content-length') ?? '0', 10) || 0;
    const ar = resp.headers.get('accept-ranges') === 'bytes';
    return { finalUrl: resp.url || url, contentLength: cl, acceptsRanges: ar };
  } catch { return { finalUrl: url, contentLength: 0, acceptsRanges: false }; }
}

// ─── 分片合并 ─────────────────────────────────────────────────────────────────
async function mergeSegmentFiles(segFiles: string[], outputUri: string, fs: typeof _FileSystem): Promise<void> {
  const allChunks: Uint8Array[] = [];
  for (const f of segFiles) {
    try {
      const b64 = await fs.readAsStringAsync(f, { encoding: fs.EncodingType.Base64 });
      const bStr = atob(b64);
      const bytes = new Uint8Array(bStr.length);
      for (let i = 0; i < bStr.length; i++) bytes[i] = bStr.charCodeAt(i);
      allChunks.push(bytes);
    } catch { /* 跳过损坏分片 */ }
  }
  const total = allChunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of allChunks) { merged.set(c, off); off += c.length; }
  let binary = '';
  const BATCH = 8192;
  for (let i = 0; i < merged.length; i += BATCH)
    binary += String.fromCharCode(...(merged.subarray(i, i + BATCH) as unknown as number[]));
  await fs.writeAsStringAsync(outputUri, btoa(binary), { encoding: fs.EncodingType.Base64 });
}

// ─── 下载实现 ─────────────────────────────────────────────────────────────────
async function segmentedDownload(taskId: string, info: ServerInfo): Promise<{ success: boolean; localUri?: string; error?: string }> {
  const fs = getFS(); if (!fs) return { success: false, error: '文件系统不可用' };
  const task = tasks.get(taskId); if (!task) return { success: false };
  const { finalUrl, contentLength } = info;
  const segCount = Math.min(SEGMENT_COUNT, Math.ceil(contentLength / SEGMENT_MIN_SIZE));
  const segSize = Math.ceil(contentLength / segCount);
  const tempDir = `${fs.documentDirectory ?? ''}dl_${taskId}/`;
  await fs.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => null);
  task.multiThreaded = true; task.activeChunks = segCount; task.totalBytes = contentLength; notify(task);
  const segBytes = new Array<number>(segCount).fill(0);
  const resumables: any[] = [];
  segmentResumables.set(taskId, resumables);

  const segPromises = Array.from({ length: segCount }, async (_, i) => {
    const start = i * segSize;
    const end = Math.min(start + segSize - 1, contentLength - 1);
    const segFile = `${tempDir}seg_${i}`;
    const resumable = fs.createDownloadResumable(
      finalUrl, segFile,
      { headers: { Range: `bytes=${start}-${end}` } },
      (dp: any) => {
        const t = tasks.get(taskId); if (!t || t.status !== 'downloading') return;
        segBytes[i] = dp.totalBytesWritten;
        const totalWritten = segBytes.reduce((a, b) => a + b, 0);
        const now = Date.now();
        const prev = lastProgressTime.get(taskId) ?? { ts: now, bytes: 0 };
        const elapsed = (now - prev.ts) / 1000;
        if (elapsed >= 0.3) {
          const delta = totalWritten - prev.bytes;
          lastProgressTime.set(taskId, { ts: now, bytes: totalWritten });
          t.bytesWritten = totalWritten;
          t.progress = contentLength > 0 ? totalWritten / contentLength : 0;
          const spd = elapsed > 0 ? Math.round(delta / elapsed) : t.speed;
          t.speed = spd;
          t.eta = spd > 0 ? Math.round((contentLength - totalWritten) / spd) : -1;
          notify(t);
        }
      },
    );
    resumables[i] = resumable;
    const result = await resumable.downloadAsync();
    return result ? segFile : null;
  });

  const results = await Promise.all(segPromises);
  segmentResumables.delete(taskId);
  const t = tasks.get(taskId);
  if (!t || t.status === 'paused' || t.status === 'cancelled') return { success: false };
  if (results.some((r) => r === null)) return { success: false, error: '部分分片下载失败，请重试' };
  const outputFile = `${tempDir}${task.filename}`;
  await mergeSegmentFiles(results as string[], outputFile, fs);
  for (const seg of results as string[]) await fs.deleteAsync(seg, { idempotent: true }).catch(() => null);
  return { success: true, localUri: outputFile };
}

async function singleThreadedDownload(taskId: string, info: ServerInfo): Promise<{ success: boolean; localUri?: string; error?: string }> {
  const fs = getFS(); if (!fs) return { success: false, error: '文件系统不可用' };
  const task = tasks.get(taskId); if (!task) return { success: false };
  const tempDir = `${fs.documentDirectory ?? ''}dl_${taskId}/`;
  await fs.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => null);
  const localUri = `${tempDir}${task.filename}`;
  if (info.contentLength > 0) { task.totalBytes = info.contentLength; notify(task); }

  const resumable = fs.createDownloadResumable(
    info.finalUrl, localUri, {},
    (dp: any) => {
      const t = tasks.get(taskId); if (!t || t.status !== 'downloading') return;
      const { totalBytesWritten, totalBytesExpectedToWrite } = dp;
      const now = Date.now();
      const prev = lastProgressTime.get(taskId) ?? { ts: now, bytes: 0 };
      const elapsed = (now - prev.ts) / 1000;
      if (elapsed >= 0.3) {
        const delta = totalBytesWritten - prev.bytes;
        lastProgressTime.set(taskId, { ts: now, bytes: totalBytesWritten });
        t.bytesWritten = totalBytesWritten;
        t.totalBytes = totalBytesExpectedToWrite || info.contentLength;
        t.progress = t.totalBytes > 0 ? totalBytesWritten / t.totalBytes : 0;
        const spd = elapsed > 0 ? Math.round(delta / elapsed) : t.speed;
        t.speed = spd;
        t.eta = spd > 0 && t.totalBytes > 0 ? Math.round((t.totalBytes - totalBytesWritten) / spd) : -1;
        notify(t);
      }
    },
  );
  segmentResumables.set(taskId, [resumable]);

  try {
    const result = await resumable.downloadAsync();
    segmentResumables.delete(taskId);
    const t = tasks.get(taskId); if (!t) return { success: false };
    if (result) return { success: true, localUri: result.uri };
    return { success: false, error: '下载被取消' };
  } catch (e: any) {
    segmentResumables.delete(taskId);
    const t = tasks.get(taskId);
    if (!t || t.status === 'paused' || t.status === 'cancelled') return { success: false };
    const msg: string = e?.message ?? '';
    if (msg.includes('Network request failed') || msg.includes('Unable to resolve host'))
      return { success: false, error: '网络连接失败，请检查网络后重试' };
    if (msg.includes('No space left') || msg.includes('ENOSPC'))
      return { success: false, error: '存储空间不足，请清理后重试' };
    if (msg.includes('403') || msg.includes('Forbidden'))
      return { success: false, error: '下载链接无权访问（403），请重新获取' };
    if (msg.includes('404') || msg.includes('Not Found'))
      return { success: false, error: '文件不存在（404），该版本可能已删除' };
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT'))
      return { success: false, error: '下载超时，请检查网络后重试' };
    return { success: false, error: msg || '下载失败，请重试' };
  }
}

// ─── 任务生命周期 ─────────────────────────────────────────────────────────────
async function startTask(id: string) {
  const task = tasks.get(id); if (!task) return;
  if (IS_WEB) {
    task.status = 'completed'; task.progress = 1; task.localUri = task.url;
    if (typeof window !== 'undefined') window.open(task.url, '_blank');
    notify(task); flushQueue(); return;
  }
  // ① 解析 URL
  task.status = 'resolving'; task.multiThreaded = false; task.activeChunks = 0; task.error = null;
  notify(task);
  const info = await resolveUrl(task.url);
  const t0 = tasks.get(id);
  if (!t0 || t0.status === 'cancelled' || t0.status === 'paused') return;
  task.status = 'downloading'; notify(task);

  // ② 分片 or 单线程
  const useSegmented = info.acceptsRanges && info.contentLength >= SEGMENT_MIN_SIZE && !IS_WEB;
  const result = useSegmented ? await segmentedDownload(id, info) : await singleThreadedDownload(id, info);

  const t = tasks.get(id); if (!t) return;
  if (result.success && result.localUri) {
    const validErr = await validateFile(result.localUri);
    if (validErr) { t.status = 'failed'; t.error = validErr; notify(t); return; }
    t.status = 'completed'; t.progress = 1; t.speed = 0; t.eta = 0; t.bytesWritten = t.totalBytes;
    const fs = getFS();
    if (Platform.OS === 'android' && fs) {
      t.localUri = await moveToSafDownloads(result.localUri, t.filename);
      const tempDir = result.localUri.substring(0, result.localUri.lastIndexOf('/'));
      await fs.deleteAsync(tempDir, { idempotent: true }).catch(() => null);
    } else { t.localUri = result.localUri; }
  } else if (t.status !== 'cancelled' && t.status !== 'paused') {
    t.status = 'failed'; t.error = result.error || '下载失败，请重试';
  }
  notify(t); flushQueue();
}

async function validateFile(uri: string): Promise<string | null> {
  if (IS_WEB || uri.startsWith('content://')) return null;
  const fs = getFS(); if (!fs) return null;
  try {
    const info = await fs.getInfoAsync(uri);
    if (!info.exists) return '文件不存在，可能已被删除';
    if ((info as any).size === 0) return '文件大小为 0，下载可能不完整';
    return null;
  } catch { return null; }
}

// ─── 公开 API ─────────────────────────────────────────────────────────────────
export function subscribe(cb: ProgressCallback): () => void { subscribers.add(cb); return () => subscribers.delete(cb); }
export function getAllTasks(): DownloadTask[] { return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt); }
export function getTask(id: string): DownloadTask | undefined { return tasks.get(id); }
export function findTaskByUrl(url: string): DownloadTask | undefined { return [...tasks.values()].find((t) => t.url === url); }

export function enqueue(params: { url: string; filename: string; appId: number; appName: string; owner: string; repo: string; avatarUrl: string; version: string; }): string {
  const id = genId();
  const task: DownloadTask = { id, ...params, status: 'pending', progress: 0, bytesWritten: 0, totalBytes: 0, speed: 0, eta: -1, localUri: null, error: null, createdAt: Date.now(), multiThreaded: false, activeChunks: 0 };
  tasks.set(id, task); notify(task); flushQueue(); return id;
}

export function retry(oldId: string): string {
  const old = tasks.get(oldId); if (!old) return '';
  tasks.delete(oldId); lastProgressTime.delete(oldId); segmentResumables.delete(oldId);
  return enqueue({ url: old.url, filename: old.filename, appId: old.appId, appName: old.appName, owner: old.owner, repo: old.repo, avatarUrl: old.avatarUrl, version: old.version });
}

export async function pause(id: string): Promise<void> {
  const task = tasks.get(id);
  if (!task || (task.status !== 'downloading' && task.status !== 'resolving')) return;
  task.status = 'paused'; task.speed = 0; task.eta = -1; notify(task);
  for (const r of segmentResumables.get(id) ?? []) { try { await r.pauseAsync(); } catch { /* ignore */ } }
}

export async function resume(id: string): Promise<void> {
  const task = tasks.get(id); if (!task || task.status !== 'paused') return;
  task.status = 'pending'; notify(task); flushQueue();
}

export async function cancel(id: string): Promise<void> {
  const task = tasks.get(id); if (!task) return;
  task.status = 'cancelled';
  for (const r of segmentResumables.get(id) ?? []) { try { r.cancelAsync?.(); } catch { /* ignore */ } }
  segmentResumables.delete(id);
  if (!IS_WEB && task.localUri) { const fs = getFS(); if (fs) fs.deleteAsync(task.localUri, { idempotent: true }).catch(() => null); }
  tasks.delete(id); lastProgressTime.delete(id); flushQueue();
}

export async function deleteFile(id: string): Promise<void> {
  const task = tasks.get(id); if (!task) return;
  if (['downloading','pending','resolving'].includes(task.status)) {
    await cancel(id); subscribers.forEach((cb) => cb({ id: '__refresh__' } as any)); return;
  }
  if (!IS_WEB && task.localUri) { const fs = getFS(); if (fs) fs.deleteAsync(task.localUri, { idempotent: true }).catch(() => null); }
  tasks.delete(id); lastProgressTime.delete(id); subscribers.forEach((cb) => cb({ id: '__refresh__' } as any));
}

export function clearFinished(): void {
  for (const [id, task] of tasks.entries()) {
    if (['completed','failed','cancelled'].includes(task.status)) { tasks.delete(id); lastProgressTime.delete(id); }
  }
  subscribers.forEach((cb) => cb({ id: '__refresh__' } as any));
}

export function pauseAll(): void {
  for (const [id, task] of tasks) {
    if (['downloading','pending','resolving'].includes(task.status)) {
      task.status = 'paused'; task.speed = 0; task.eta = -1; notify(task);
      for (const r of segmentResumables.get(id) ?? []) { r.pauseAsync?.().catch(() => {}); }
    }
  }
}

export function resumeAll(): void {
  for (const [, task] of tasks) { if (task.status === 'paused') { task.status = 'pending'; notify(task); } }
  flushQueue();
}

export function clearAllTasks(): void {
  for (const [id, task] of tasks.entries()) {
    if (['downloading','resolving'].includes(task.status)) {
      for (const r of segmentResumables.get(id) ?? []) { r.cancelAsync?.().catch(() => {}); }
    }
    tasks.delete(id); lastProgressTime.delete(id); segmentResumables.delete(id);
  }
  subscribers.forEach((cb) => cb({ id: '__refresh__' } as any));
}
