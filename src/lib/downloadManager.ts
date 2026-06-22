/**
 * 下载管理器 v16 — 统一下载路径 + GitHub URL 优先续传
 *
 * 策略：
 *  1. 始终使用 task.url（github.com 原始链接），从不缓存 CDN 签名 URL
 *  2. 下载完成后统一 moveAsync → dl_perm/，通过 FileProvider 安装，不走 SAF base64
 *  3. RST_STREAM/CANCEL 等 HTTP/2 CDN 错误：立即清除 resumeData + 部分文件，
 *     下一次重试用原始 URL 让 GitHub 生成新鲜 CDN 链接（等同 wget -c 语义）
 *  4. 普通瞬态错误（断网/超时）：保留部分文件 + resumeData，续传节省流量
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as _FileSystem from 'expo-file-system/legacy';

const IS_WEB = Platform.OS === 'web';
const SAF_URI_KEY = '@openappstore/saf_downloads_uri';
const MAX_CONCURRENT = 3;
// 所有文件（不论大小）统一移入持久目录，通过 FileProvider 安装
const PERM_DIR_NAME = 'dl_perm';
const MAX_AUTO_RETRY = 5;                              // 最多自动续传 5 次
const RESUME_KEY_PREFIX = '@openappstore/resume_';     // AsyncStorage 断点数据 key

function getFS(): typeof _FileSystem | null {
  return IS_WEB ? null : _FileSystem;
}

// ─── SAF ─────────────────────────────────────────────────────────────────────
let _safDirUri: string | null | undefined = undefined;

async function loadSafUri(): Promise<string | null> {
  if (_safDirUri !== undefined) return _safDirUri;
  const stored = await AsyncStorage.getItem(SAF_URI_KEY).catch(() => null);
  const fs = getFS();
  if (!fs) { _safDirUri = null; return null; }
  if (stored) {
    try {
      await fs.StorageAccessFramework.readDirectoryAsync(stored);
      _safDirUri = stored;
      return stored;
    } catch {
      _safDirUri = null;
      await AsyncStorage.removeItem(SAF_URI_KEY).catch(() => null);
    }
  } else {
    _safDirUri = null;
  }
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
    _safDirUri = result.directoryUri;
    await AsyncStorage.setItem(SAF_URI_KEY, result.directoryUri).catch(() => null);
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

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
export function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.apk'))  return 'application/vnd.android.package-archive';
  if (lower.endsWith('.ipa') || lower.endsWith('.pkg')) return 'application/octet-stream';
  if (lower.endsWith('.exe'))  return 'application/vnd.microsoft.portable-executable';
  if (lower.endsWith('.msi'))  return 'application/x-msi';
  if (lower.endsWith('.dmg'))  return 'application/x-apple-diskimage';
  if (lower.endsWith('.deb'))  return 'application/vnd.debian.binary-package';
  if (lower.endsWith('.rpm'))  return 'application/x-rpm';
  if (lower.endsWith('.zip'))  return 'application/zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'application/gzip';
  return 'application/octet-stream';
}

export function isInstallerFile(filename: string): boolean {
  return ['.apk', '.ipa', '.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.appimage']
    .some((e) => filename.toLowerCase().endsWith(e));
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
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

// ─── 类型定义 ─────────────────────────────────────────────────────────────────
export type DownloadStatus = 'pending' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  appId: number;
  appName: string;
  owner: string;
  repo: string;
  avatarUrl: string;
  version: string;
  status: DownloadStatus;
  progress: number;
  bytesWritten: number;
  totalBytes: number;
  speed: number;
  eta: number;
  localUri: string | null;
  error: string | null;
  createdAt: number;
  _autoRetryCount?: number;
}

export const REFRESH_EVENT = Symbol('download_refresh');

type ProgressCallback = (task: DownloadTask | { id: typeof REFRESH_EVENT }) => void;

// ─── 全局状态 ─────────────────────────────────────────────────────────────────
const tasks = new Map<string, DownloadTask>();
const subscribers = new Set<ProgressCallback>();
/** 活跃的 expo-file-system DownloadResumable，用于暂停/取消 */
const activeSessions = new Map<string, _FileSystem.DownloadResumable>();
const speedSampler = new Map<string, { ts: number; bytes: number }>();

function genId(): string { return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
function notify(task: DownloadTask) { subscribers.forEach((cb) => cb({ ...task })); }
function notifyRefresh() { subscribers.forEach((cb) => cb({ id: REFRESH_EVENT })); }

function flushQueue() {
  const active = [...tasks.values()].filter((t) => t.status === 'downloading').length;
  if (active >= MAX_CONCURRENT) return;
  const next = [...tasks.values()].find((t) => t.status === 'pending');
  if (next) startTask(next.id);
}

function isTransientError(msg: string): boolean {
  return (
    msg.includes('Network request failed') ||
    msg.includes('Unable to resolve host') ||
    msg.includes('timeout') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('socket hang up') ||
    // GitHub CDN HTTP/2 RST_STREAM CANCEL — Android OkHttp 与 GitHub CDN 的 HTTP/2
    // 连接被服务端重置，属于暂时性 CDN 问题，重试可恢复
    msg.includes('stream was reset') ||
    msg.includes('CANCEL') ||
    msg.includes('RST_STREAM') ||
    msg.includes('unexpected end of stream')
  );
}

function mapErrorMessage(msg: string): string {
  if (!msg) return '下载失败，请重试';
  if (msg.includes('Network request failed') || msg.includes('Unable to resolve host'))
    return '网络连接失败，请检查网络后重试';
  if (msg.includes('No space left') || msg.includes('ENOSPC'))
    return '存储空间不足，请清理后重试';
  if (msg.includes('403') || msg.includes('Forbidden'))
    return '下载链接已失效（403），请重新获取';
  if (msg.includes('404') || msg.includes('Not Found'))
    return '文件不存在（404），该版本可能已删除';
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT'))
    return '下载超时，请检查网络后重试';
  if (msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED'))
    return '连接被重置，请检查网络后重试';
  if (msg.includes('ENOTFOUND') || msg.includes('DNS'))
    return 'DNS 解析失败，请检查网络连接';
  return msg;
}

async function cleanupTempDir(id: string) {
  if (IS_WEB) return;
  const fs = getFS();
  if (!fs) return;
  const tempDir = `${fs.documentDirectory ?? ''}dl_${id}/`;
  await fs.deleteAsync(tempDir, { idempotent: true }).catch(() => null);
}

/** 将文件从 tempDir 移入持久存储（documentDirectory/dl_perm/），返回新 URI */
async function moveToPermanentStorage(tempUri: string, filename: string): Promise<string> {
  const fs = getFS()!;
  const permDir = `${fs.documentDirectory ?? ''}${PERM_DIR_NAME}/`;
  await fs.makeDirectoryAsync(permDir, { intermediates: true }).catch(() => null);
  const destUri = `${permDir}${filename}`;
  // 目标已存在则先删除（同名旧版本）
  await fs.deleteAsync(destUri, { idempotent: true }).catch(() => null);
  await fs.moveAsync({ from: tempUri, to: destUri });
  // 移动后验证目标文件确实存在且非空
  const info = await fs.getInfoAsync(destUri).catch(() => ({ exists: false }));
  if (!info.exists || (info as any).size === 0) {
    throw new Error(`moveAsync 后目标文件不存在或大小为0: ${destUri}`);
  }
  return destUri;
}

// ─── 核心下载逻辑 ─────────────────────────────────────────────────────────────

async function startTask(id: string) {
  const task = tasks.get(id);
  if (!task) return;

  if (IS_WEB) {
    task.status = 'completed';
    task.progress = 1;
    task.localUri = task.url;
    if (typeof window !== 'undefined') window.open(task.url, '_blank');
    notify(task);
    flushQueue();
    return;
  }

  const fs = getFS();
  if (!fs) { task.status = 'failed'; task.error = '文件系统不可用'; notify(task); flushQueue(); return; }

  const tempDir = `${fs.documentDirectory ?? ''}dl_${id}/`;
  const localUri = `${tempDir}${task.filename}`;
  const resumeKey = `${RESUME_KEY_PREFIX}${id}`;

  await fs.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => null);

  // ── 加载断点续传数据 ────────────────────────────────────────────────────────
  let resumeData: string | undefined;
  try {
    const saved = await AsyncStorage.getItem(resumeKey);
    if (saved) {
      // 确认部分文件仍存在，否则清除断点并从头下载
      const info = await fs.getInfoAsync(localUri).catch(() => ({ exists: false }));
      resumeData = info.exists ? saved : undefined;
      if (!info.exists) await AsyncStorage.removeItem(resumeKey).catch(() => null);
    }
  } catch { /* ignore */ }

  task.status = 'downloading';
  task.error = null;
  if (!resumeData) {
    // 全新下载时才重置进度，续传时保留已显示的进度
    task.progress = 0;
    task.bytesWritten = 0;
    task.totalBytes = 0;
  }
  task.speed = 0;
  task.eta = -1;
  notify(task);

  // ── expo-file-system createDownloadResumable（直接传原始 URL，底层自动跟随 302）───
  let lastSaveTs = 0;
  let resumableRef: _FileSystem.DownloadResumable | null = null;

  const progressCallback = (dp: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
    const t = tasks.get(id);
    if (!t || t.status !== 'downloading') return;

    const { totalBytesWritten, totalBytesExpectedToWrite } = dp;
    const now = Date.now();
    const prev = speedSampler.get(id) ?? { ts: now, bytes: 0 };
    const elapsed = (now - prev.ts) / 1000;

    let speed = t.speed;
    if (elapsed >= 0.5) {
      speed = Math.round((totalBytesWritten - prev.bytes) / elapsed);
      speedSampler.set(id, { ts: now, bytes: totalBytesWritten });
    }

    t.bytesWritten = totalBytesWritten;
    if (totalBytesExpectedToWrite > 0) t.totalBytes = totalBytesExpectedToWrite;
    t.progress = t.totalBytes > 0 ? totalBytesWritten / t.totalBytes : -1;
    t.speed = speed > 0 ? speed : 0;
    t.eta = speed > 0 && t.totalBytes > 0
      ? Math.round((t.totalBytes - totalBytesWritten) / speed)
      : -1;

    notify(t);

    // 每 3 秒持久化一次断点数据，应用崩溃后也能续传
    if (now - lastSaveTs > 3000 && resumableRef) {
      lastSaveTs = now;
      try {
        const state = resumableRef.savable();
        if (state.resumeData) {
          AsyncStorage.setItem(resumeKey, JSON.stringify(state.resumeData)).catch(() => null);
        }
      } catch { /* ignore */ }
    }
  };

  const resumable = fs.createDownloadResumable(
    task.url,
    localUri,
    { headers: { 'User-Agent': 'OpenAppStore/1.0' } },
    progressCallback,
    resumeData ? JSON.parse(resumeData) : undefined,
  );
  resumableRef = resumable;
  activeSessions.set(id, resumable);

  // ── 卡顿检测：60s 无字节增量则保存断点并自动续传 ──────────────────────────
  let lastBytesForStall = 0;
  const stallTimer = setInterval(() => {
    const t = tasks.get(id);
    if (!t || t.status !== 'downloading') { clearInterval(stallTimer); return; }
    if (t.bytesWritten === lastBytesForStall) {
      clearInterval(stallTimer);
      // 卡顿时先保存当前断点
      try {
        const state = resumableRef?.savable();
        if (state?.resumeData) {
          AsyncStorage.setItem(resumeKey, JSON.stringify(state.resumeData)).catch(() => null);
        }
      } catch { /* ignore */ }
      activeSessions.get(id)?.cancelAsync?.().catch(() => {});
      activeSessions.delete(id);
      if ((t._autoRetryCount ?? 0) < MAX_AUTO_RETRY) {
        t._autoRetryCount = (t._autoRetryCount ?? 0) + 1;
        t.status = 'pending';
        t.error = `网络中断，自动续传 (${t._autoRetryCount}/${MAX_AUTO_RETRY})...`;
        t.speed = 0; t.eta = -1;
        // ⚠️ 不删 tempDir，不重置进度——保留部分文件用于续传
      } else {
        t.status = 'failed';
        t.error = '下载超时，请检查网络后手动重试';
        AsyncStorage.removeItem(resumeKey).catch(() => null);
        cleanupTempDir(id);
      }
      notify(t);
      flushQueue();
    } else {
      lastBytesForStall = t.bytesWritten;
    }
  }, 60_000);

  try {
    const result = await resumable.downloadAsync();

    clearInterval(stallTimer);
    activeSessions.delete(id);
    speedSampler.delete(id);
    resumableRef = null;
    // 下载完成，清除断点数据
    await AsyncStorage.removeItem(resumeKey).catch(() => null);

    const t = tasks.get(id);
    if (!t) return;

    // 暂停/取消时 downloadAsync 返回 undefined
    if (!result) {
      if (t.status !== 'paused' && t.status !== 'cancelled') {
        t.status = 'failed';
        t.error = '下载中断，请重试';
        notify(t);
      }
      flushQueue();
      return;
    }

    // 校验文件大小
    let actualSize = 0;
    try {
      const info = await fs.getInfoAsync(result.uri);
      actualSize = (info as any).size ?? 0;
    } catch { /* ignore */ }

    if (actualSize === 0) {
      t.status = 'failed';
      t.error = '下载文件大小为 0，请重试';
      notify(t);
      await cleanupTempDir(id);
      flushQueue();
      return;
    }

    t.status = 'completed';
    t.progress = 1;
    t.speed = 0;
    t.eta = 0;
    t.bytesWritten = actualSize;
    t.totalBytes = actualSize;

    if (Platform.OS === 'android') {
      // 统一路径：所有文件移入持久目录，通过 FileProvider content URI 安装
      // 不再区分文件大小，不再走 SAF base64（彻底避免 0 字节灰包和内存溢出）
      try {
        const permUri = await moveToPermanentStorage(result.uri, t.filename);
        t.localUri = permUri;
        t.error = null;
      } catch (mvErr) {
        console.warn('[DownloadManager] 持久化移动失败，保留 tempDir:', (mvErr as Error)?.message);
        t.localUri = result.uri;
      }
      // 文件已移出 tempDir 才删除临时目录
      if (!t.localUri!.startsWith(tempDir)) {
        await fs.deleteAsync(tempDir, { idempotent: true }).catch(() => null);
      }
    } else {
      t.localUri = result.uri;
    }

    notify(t);
    flushQueue();
  } catch (e: any) {
    clearInterval(stallTimer);
    activeSessions.delete(id);
    speedSampler.delete(id);
    resumableRef = null;

    const t = tasks.get(id);
    if (!t) { flushQueue(); return; }

    const msg: string = e?.message ?? '';

    if (isTransientError(msg) && (t._autoRetryCount ?? 0) < MAX_AUTO_RETRY) {
      t._autoRetryCount = (t._autoRetryCount ?? 0) + 1;
      t.status = 'pending';
      t.error = `网络波动，自动续传中 (${t._autoRetryCount}/${MAX_AUTO_RETRY})...`;
      t.speed = 0;
      t.eta = -1;
      notify(t);
      // HTTP/2 RST_STREAM 类错误：CDN 签名 URL 在 resumeData 里已过期
      // 立即清除 resumeData + 部分文件，下次重试用原始 github.com URL 拿新鲜 CDN 链接
      // （等同 wget -c 失败后重新执行同一命令的语义）
      const isHttp2Reset = msg.includes('stream was reset') || msg.includes('CANCEL') || msg.includes('RST_STREAM');
      if (isHttp2Reset) {
        await AsyncStorage.removeItem(resumeKey).catch(() => null);
        await cleanupTempDir(id);
        t.bytesWritten = 0;
        t.totalBytes = 0;
        t.progress = 0;
      }
      // 普通瞬态错误（断网/超时）：保留部分文件 + resumeData，下次续传节省流量
      flushQueue();
      return;
    }

    // 重试耗尽才清理
    t.status = 'failed';
    t.error = mapErrorMessage(msg);
    notify(t);
    await AsyncStorage.removeItem(resumeKey).catch(() => null);
    await cleanupTempDir(id);
    flushQueue();
  }
}

// ─── 公开 API ─────────────────────────────────────────────────────────────────
export function subscribe(cb: ProgressCallback): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getAllTasks(): DownloadTask[] {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getTask(id: string): DownloadTask | undefined { return tasks.get(id); }

export function findTaskByUrl(url: string): DownloadTask | undefined {
  if (!url) return undefined;
  return [...tasks.values()].find((t) => t.url === url);
}

export function enqueue(params: {
  url: string; filename: string; appId: number; appName: string;
  owner: string; repo: string; avatarUrl: string; version: string;
}): string {
  if (!params.url || typeof params.url !== 'string' || !params.url.startsWith('http')) {
    throw new Error('下载链接无效');
  }
  const existing = findTaskByUrl(params.url);
  if (existing && ['pending', 'downloading', 'paused'].includes(existing.status)) {
    return existing.id;
  }
  if (existing && ['completed', 'failed'].includes(existing.status)) {
    tasks.delete(existing.id);
  }

  const id = genId();
  const task: DownloadTask = {
    id, ...params,
    status: 'pending', progress: 0, bytesWritten: 0, totalBytes: 0,
    speed: 0, eta: -1, localUri: null, error: null, createdAt: Date.now(),
    _autoRetryCount: 0,
  };
  tasks.set(id, task);
  notify(task);
  flushQueue();
  return id;
}

export function retry(oldId: string): string {
  const old = tasks.get(oldId);
  if (!old) return '';

  tasks.delete(oldId);

  const newId = genId();
  const task: DownloadTask = {
    id: newId,
    url: old.url, filename: old.filename, appId: old.appId, appName: old.appName,
    owner: old.owner, repo: old.repo, avatarUrl: old.avatarUrl, version: old.version,
    status: 'pending', progress: 0, bytesWritten: 0, totalBytes: 0,
    speed: 0, eta: -1, localUri: null, error: null, createdAt: Date.now(),
    _autoRetryCount: 0,
  };
  tasks.set(newId, task);
  notify(task);
  flushQueue();
  return newId;
}

export async function pause(id: string): Promise<void> {
  const task = tasks.get(id);
  if (!task || task.status !== 'downloading') return;

  // 取消活跃的 session
  const session = activeSessions.get(id);
  if (session) {
    session?.cancelAsync?.().catch(() => {});
    activeSessions.delete(id);
  }

  task.status = 'paused';
  task.speed = 0;
  task.eta = -1;
  speedSampler.delete(id);
  notify(task);
}

export async function resume(id: string): Promise<void> {
  const task = tasks.get(id);
  if (!task || task.status !== 'paused') return;
  task.status = 'pending';
  task.error = null;
  notify(task);
  flushQueue();
}

export async function cancel(id: string): Promise<void> {
  const task = tasks.get(id);
  if (!task) return;

  const session = activeSessions.get(id);
  if (session) {
    session?.cancelAsync?.().catch(() => {});
    activeSessions.delete(id);
  }

  task.status = 'cancelled';
  speedSampler.delete(id);
  await cleanupTempDir(id);
  notify(task);
  tasks.delete(id);
  flushQueue();
}

export async function deleteFile(id: string): Promise<void> {
  const task = tasks.get(id);
  if (!task) return;

  if (['downloading', 'pending'].includes(task.status)) {
    await cancel(id);
    notifyRefresh();
    return;
  }

  if (!IS_WEB && task.localUri) {
    const fs = getFS();
    if (fs) await fs.deleteAsync(task.localUri, { idempotent: true }).catch(() => null);
  }

  tasks.delete(id);
  speedSampler.delete(id);
  notifyRefresh();
}

export function clearFinished(): void {
  for (const [id, task] of tasks.entries()) {
    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      tasks.delete(id);
      speedSampler.delete(id);
    }
  }
  notifyRefresh();
}

export async function pauseAll(): Promise<void> {
  for (const [id, task] of tasks) {
    if (task.status === 'downloading' || task.status === 'pending') {
      const session = activeSessions.get(id);
      if (session) {
        session?.cancelAsync?.().catch(() => {});
        activeSessions.delete(id);
      }
      task.status = 'paused';
      task.speed = 0;
      task.eta = -1;
      speedSampler.delete(id);
      notify(task);
    }
  }
}

export function resumeAll(): void {
  for (const [, task] of tasks) {
    if (task.status === 'paused') {
      task.status = 'pending';
      task.error = null;
      notify(task);
    }
  }
  flushQueue();
}

export function clearAllTasks(): void {
  for (const [id] of tasks.entries()) {
    const session = activeSessions.get(id);
    if (session) {
      session?.cancelAsync?.().catch(() => {});
      activeSessions.delete(id);
    }
    cleanupTempDir(id);
  }
  tasks.clear();
  speedSampler.clear();
  notifyRefresh();
}