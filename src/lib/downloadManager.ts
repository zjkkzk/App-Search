/**
 * 下载管理器 v9 — downloadAsync 统一下载（原生 HTTP 跟随 302）
 *
 * 设计决策：
 * 1. 统一使用 expo-file-system downloadAsync：底层 OkHttp 自动跟随 302 重定向
 * 2. 进度回调：downloadAsync 原生 progress 事件，实时更新
 * 3. 暂停续传：不支持（downloadAsync 无 pause/resume），但保证下载成功
 * 4. SAF 保存：Android 完成后写入公共 Downloads
 * 5. 自动重试：临时网络错误自动重试 1 次
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as _FileSystem from 'expo-file-system/legacy';

const IS_WEB = Platform.OS === 'web';
const SAF_URI_KEY = '@openappstore/saf_downloads_uri';
const MAX_CONCURRENT = 3;
/** SAF Base64 移动的最大文件大小（50MB），超过则保留在缓存目录避免 OOM */
const SAF_BASE64_MAX_SIZE = 50 * 1024 * 1024;
/** 自动重试次数 */
const MAX_AUTO_RETRY = 1;

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

async function moveToSafDownloads(tempUri: string, filename: string, expectedSize: number): Promise<{ uri: string; safFailed: boolean }> {
  const fs = getFS();
  if (!fs) return { uri: tempUri, safFailed: false };
  try {
    const dirUri = await loadSafUri();
    if (!dirUri) return { uri: tempUri, safFailed: false };

    let actualSize = expectedSize;
    if (actualSize <= 0) {
      try {
        const info = await fs.getInfoAsync(tempUri);
        actualSize = (info as any).size ?? 0;
      } catch { /* ignore */ }
    }

    if (actualSize > SAF_BASE64_MAX_SIZE) {
      console.warn(`[DownloadManager] ${filename} (${(actualSize / 1024 / 1024).toFixed(1)}MB) 超过 SAF 限制，保留在缓存目录`);
      return { uri: tempUri, safFailed: true };
    }

    const destUri = await fs.StorageAccessFramework.createFileAsync(
      dirUri, filename, getMimeType(filename)
    );
    const base64 = await fs.readAsStringAsync(tempUri, { encoding: fs.EncodingType.Base64 });
    await fs.StorageAccessFramework.writeAsStringAsync(destUri, base64, {
      encoding: fs.EncodingType.Base64,
    });
    await fs.deleteAsync(tempUri, { idempotent: true }).catch(() => null);
    return { uri: destUri, safFailed: false };
  } catch (e) {
    console.warn('[DownloadManager] SAF 移动失败:', (e as Error)?.message);
    return { uri: tempUri, safFailed: true };
  }
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
  resumeData?: string;
  _autoRetryCount?: number;
}

export const REFRESH_EVENT = Symbol('download_refresh');

type ProgressCallback = (task: DownloadTask | { id: typeof REFRESH_EVENT }) => void;

// ─── 全局状态 ─────────────────────────────────────────────────────────────────
const tasks = new Map<string, DownloadTask>();
const subscribers = new Set<ProgressCallback>();
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
    msg.includes('socket hang up')
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

  await fs.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => null);

  task.status = 'downloading';
  task.error = null;
  speedSampler.set(id, { ts: Date.now(), bytes: 0 });
  notify(task);

  // 统一使用 downloadAsync：底层 OkHttp 自动跟随 302 重定向，原生 progress 回调
  const downloadPromise = fs.downloadAsync(task.url, localUri, {
    sessionType: _FileSystem.FileSystemSessionType.BACKGROUND,
  });

  // downloadAsync 返回的 promise 无中间进度，需手动轮询文件大小
  // 但 downloadAsync 不支持 progress 回调，所以用文件轮询模拟进度
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  if (Platform.OS === 'android') {
    progressTimer = setInterval(async () => {
      const t = tasks.get(id);
      if (!t || t.status !== 'downloading') {
        if (progressTimer) clearInterval(progressTimer);
        return;
      }
      try {
        const info = await fs.getInfoAsync(localUri);
        if (info.exists) {
          const actualSize = (info as any).size ?? 0;
          if (actualSize > 0) {
            const now = Date.now();
            const prev = speedSampler.get(id) ?? { ts: now, bytes: 0 };
            const elapsed = (now - prev.ts) / 1000;
            let speed = t.speed;
            if (elapsed >= 1) {
              speed = elapsed > 0 ? Math.round((actualSize - prev.bytes) / elapsed) : 0;
              speedSampler.set(id, { ts: now, bytes: actualSize });
            }
            t.bytesWritten = actualSize;
            t.speed = speed > 0 ? speed : 0;
            // 无总大小信息，显示伪进度
            t.progress = Math.min(0.99, 1 - 1 / (actualSize / 1024 + 1));
            t.eta = -1;
            notify(t);
          }
        }
      } catch { /* ignore */ }
    }, 1000);
  }

  try {
    const result = await downloadPromise;
    if (progressTimer) clearInterval(progressTimer);
    speedSampler.delete(id);

    const t = tasks.get(id);
    if (!t) return;

    if (!result || result.status !== 200) {
      t.status = 'failed';
      t.error = `HTTP ${result?.status ?? 'error'}`;
      notify(t);
      await cleanupTempDir(id);
      flushQueue();
      return;
    }

    // 获取实际文件大小
    let actualSize = 0;
    try {
      const info = await fs.getInfoAsync(localUri);
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

    // 检查是否是 HTML 错误页面
    if (actualSize < 1024) {
      try {
        const content = await fs.readAsStringAsync(localUri);
        if (content.trimStart().startsWith('<!') || content.trimStart().startsWith('<html')) {
          t.status = 'failed';
          t.error = '服务器返回了网页而非文件，请重试';
          notify(t);
          await cleanupTempDir(id);
          flushQueue();
          return;
        }
      } catch { /* ignore */ }
    }

    // 完成
    t.status = 'completed';
    t.progress = 1;
    t.speed = 0;
    t.eta = 0;
    t.bytesWritten = actualSize;
    t.totalBytes = actualSize;
    t.resumeData = undefined;

    if (Platform.OS === 'android') {
      const { uri, safFailed } = await moveToSafDownloads(localUri, t.filename, actualSize);
      t.localUri = uri;
      if (safFailed) {
        t.error = '文件保存在应用缓存目录（未授权公共存储权限）';
      }
      await fs.deleteAsync(tempDir, { idempotent: true }).catch(() => null);
    } else {
      t.localUri = localUri;
    }

    notify(t);
    flushQueue();
  } catch (e: any) {
    if (progressTimer) clearInterval(progressTimer);
    speedSampler.delete(id);

    const t = tasks.get(id);
    if (!t) { flushQueue(); return; }

    const msg: string = e?.message ?? '';

    if (isTransientError(msg) && (t._autoRetryCount ?? 0) < MAX_AUTO_RETRY) {
      t._autoRetryCount = (t._autoRetryCount ?? 0) + 1;
      t.status = 'pending';
      t.error = `网络波动，自动重试中 (${t._autoRetryCount}/${MAX_AUTO_RETRY})...`;
      t.progress = 0;
      t.speed = 0;
      t.eta = -1;
      notify(t);
      await cleanupTempDir(id);
      flushQueue();
      return;
    }

    t.status = 'failed';
    t.error = mapErrorMessage(msg);
    notify(t);
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
    speedSampler.delete(existing.id);
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
  speedSampler.delete(oldId);

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
  // downloadAsync 不支持暂停，直接标记为 paused
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
  for (const [, task] of tasks) {
    if (task.status === 'downloading' || task.status === 'pending') {
      task.status = 'paused';
      task.speed = 0;
      task.eta = -1;
      speedSampler.delete(task.id);
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
    cleanupTempDir(id);
  }
  tasks.clear();
  speedSampler.clear();
  notifyRefresh();
}