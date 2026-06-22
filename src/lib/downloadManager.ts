/**
 * 下载管理器 v19 — Android 改用系统 DownloadManager（Web 壳架构）
 *
 * 引擎选择：
 *  - Android : Linking.openURL() → 系统浏览器/DownloadManager 全权处理
 *              (下载进度在通知栏，文件存入系统 Downloads，安装时打开系统文件管理)
 *  - iOS     : expo-file-system (NSURLSession) — 原生 iOS 网络层，断点续传
 *  - Web     : window.open() 交给浏览器
 *
 * Android 存储策略：
 *  - 由系统 DownloadManager 托管，APK 落盘至系统 Downloads 目录
 *  - 应用侧不持有文件路径，localUri 标记为 '__browser__'
 *
 * iOS 存储策略：
 *  - 文件下载到 documentDirectory/dl_${id}/ 临时目录
 *  - 完成后 moveAsync → dl_perm/，通过 share 暴露给安装器
 *
 * iOS 重试策略：
 *  - 保留 resumeData，NSURLSession 字节级续传
 *  - 最多自动重试 5 次，指数退避（2s/4s/8s…），瞬态错误自动恢复
 */
import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as _FileSystem from 'expo-file-system/legacy';

/** Android 系统下载任务的 localUri 占位标记 */
export const BROWSER_DOWNLOAD_MARKER = '__browser__';

const IS_WEB = Platform.OS === 'web';
const MAX_CONCURRENT = 3;
const PERM_DIR_NAME = 'dl_perm';
const MAX_AUTO_RETRY = 5;
const RESUME_KEY_PREFIX = '@openappstore/resume_'; // iOS 断点续传 key

function getFS(): typeof _FileSystem | null {
  return IS_WEB ? null : _FileSystem;
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
/** 活跃的 expo-file-system DownloadResumable（iOS 专用） */
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
    // GitHub CDN HTTP/2 RST_STREAM — OkHttp3 被服务端重置，属于暂时性 CDN 问题
    msg.includes('stream was reset') ||
    msg.includes('CANCEL') ||
    msg.includes('RST_STREAM') ||
    msg.includes('unexpected end of stream') ||
    // OkHttp3 / Android HttpURLConnection 连接中途断开（大文件常见）
    msg.includes('Download interrupted') ||
    msg.includes('IOException') ||
    msg.includes('read timed out') ||
    msg.includes('connection timed out') ||
    // GitHub CDN 限速/过载（临时）
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('Too Many Requests') ||
    msg.includes('Service Unavailable')
  );
}

/** 计算第 n 次重试的退避延迟（指数退避，上限 30s） */
function retryDelay(retryCount: number): number {
  return Math.min(30_000, 1_000 * (2 ** retryCount));
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
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('read timed out'))
    return '下载超时，请检查网络后重试';
  if (msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED'))
    return '连接被重置，请检查网络后重试';
  if (msg.includes('ENOTFOUND') || msg.includes('DNS'))
    return 'DNS 解析失败，请检查网络连接';
  if (msg.includes('Download interrupted') || msg.includes('IOException'))
    return '下载连接中断，请检查网络后重试';
  if (msg.includes('503') || msg.includes('429') || msg.includes('Too Many Requests'))
    return '服务器繁忙，稍后自动重试';
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

/** 通用进度更新（Android RNBlobUtil / iOS expo-fs 均复用） */
function applyProgress(id: string, bytesWritten: number, totalBytes: number) {
  const t = tasks.get(id);
  if (!t || t.status !== 'downloading') return;
  const now = Date.now();
  const prev = speedSampler.get(id) ?? { ts: now, bytes: 0 };
  const elapsed = (now - prev.ts) / 1000;
  let speed = t.speed;
  if (elapsed >= 0.5) {
    speed = Math.max(0, Math.round((bytesWritten - prev.bytes) / elapsed));
    speedSampler.set(id, { ts: now, bytes: bytesWritten });
  }
  t.bytesWritten = bytesWritten;
  if (totalBytes > 0) t.totalBytes = totalBytes;
  t.progress = t.totalBytes > 0 ? bytesWritten / t.totalBytes : -1;
  t.speed = speed;
  t.eta = speed > 0 && t.totalBytes > 0 ? Math.round((t.totalBytes - bytesWritten) / speed) : -1;
  notify(t);
}

/** Android：系统 DownloadManager — 调起系统浏览器，交由系统全权处理重定向/下载/通知 */
async function startTaskAndroid(id: string) {
  const task = tasks.get(id);
  if (!task) return;

  task.status = 'downloading';
  task.error = null;
  task.progress = 0;
  notify(task);

  try {
    // 调起系统浏览器/Chrome，让 Android DownloadManager 处理下载
    // 自动跟随 302 重定向、断点续传、通知栏进度，文件存入系统 Downloads
    await Linking.openURL(task.url);
    task.status = 'completed';
    task.progress = 1;
    // localUri 标记为 __browser__：文件由系统托管，非应用私有路径
    task.localUri = BROWSER_DOWNLOAD_MARKER;
    task.error = null;
  } catch (e: any) {
    task.status = 'failed';
    task.error = '无法调起下载，请检查网络或手动复制链接';
  }
  notify(task);
  flushQueue();
}

/** iOS：expo-file-system (NSURLSession) + 断点续传 */
async function startTaskIOS(id: string) {
  const task = tasks.get(id);
  if (!task) return;

  const fs = getFS()!;
  const tempDir = `${fs.documentDirectory ?? ''}dl_${id}/`;
  const localUri = `${tempDir}${task.filename}`;
  const resumeKey = `${RESUME_KEY_PREFIX}${id}`;

  await fs.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => null);

  // 加载断点续传数据
  let resumeData: string | undefined;
  try {
    const saved = await AsyncStorage.getItem(resumeKey);
    if (saved) {
      const info = await fs.getInfoAsync(localUri).catch(() => ({ exists: false }));
      resumeData = info.exists ? saved : undefined;
      if (!info.exists) await AsyncStorage.removeItem(resumeKey).catch(() => null);
    }
  } catch { /* ignore */ }

  task.status = 'downloading';
  task.error = null;
  if (!resumeData) { task.progress = 0; task.bytesWritten = 0; task.totalBytes = 0; }
  task.speed = 0; task.eta = -1;
  notify(task);

  let resumableRef: _FileSystem.DownloadResumable | null = null;

  const resumable = fs.createDownloadResumable(
    task.url, localUri,
    { headers: { 'User-Agent': 'OpenAppStore/1.0' } },
    (dp: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
      applyProgress(id, dp.totalBytesWritten, dp.totalBytesExpectedToWrite);
      // 每 3 秒持久化断点
      const now = Date.now();
      if (now - lastSaveTs > 3000 && resumableRef) {
        lastSaveTs = now;
        try {
          const state = resumableRef.savable();
          if (state.resumeData) AsyncStorage.setItem(resumeKey, JSON.stringify(state.resumeData)).catch(() => null);
        } catch { /* ignore */ }
      }
    },
    resumeData ? JSON.parse(resumeData) : undefined,
  );
  resumableRef = resumable;
  let lastSaveTs = 0;
  activeSessions.set(id, resumable);

  // 卡顿检测
  let lastStallBytes = 0;
  const stallTimer = setInterval(() => {
    const t = tasks.get(id);
    if (!t || t.status !== 'downloading') { clearInterval(stallTimer); return; }
    if (t.bytesWritten === lastStallBytes) {
      clearInterval(stallTimer);
      try {
        const state = resumableRef?.savable();
        if (state?.resumeData) AsyncStorage.setItem(resumeKey, JSON.stringify(state.resumeData)).catch(() => null);
      } catch { /* ignore */ }
      activeSessions.get(id)?.cancelAsync?.().catch(() => {});
      activeSessions.delete(id);
      if ((t._autoRetryCount ?? 0) < MAX_AUTO_RETRY) {
        t._autoRetryCount = (t._autoRetryCount ?? 0) + 1;
        t.status = 'pending';
        t.error = `网络中断，自动续传 (${t._autoRetryCount}/${MAX_AUTO_RETRY})...`;
        t.speed = 0; t.eta = -1;
        notify(t);
        setTimeout(() => flushQueue(), 2_000);
      } else {
        t.status = 'failed';
        t.error = '下载超时，请检查网络后手动重试';
        AsyncStorage.removeItem(resumeKey).catch(() => null);
        cleanupTempDir(id);
        notify(t);
        flushQueue();
      }
    } else { lastStallBytes = t.bytesWritten; }
  }, 60_000);

  try {
    const result = await resumable.downloadAsync();
    clearInterval(stallTimer);
    activeSessions.delete(id);
    speedSampler.delete(id);
    resumableRef = null;
    await AsyncStorage.removeItem(resumeKey).catch(() => null);

    const t = tasks.get(id);
    if (!t) return;
    if (!result) {
      if (t.status !== 'paused' && t.status !== 'cancelled') {
        t.status = 'failed'; t.error = '下载中断，请重试'; notify(t);
      }
      flushQueue(); return;
    }

    const info = await fs.getInfoAsync(result.uri).catch(() => ({ exists: false }));
    const actualSize: number = info.exists ? ((info as any).size ?? 0) : 0;
    if (actualSize === 0) {
      t.status = 'failed'; t.error = '下载文件大小为 0，请重试'; notify(t);
      await cleanupTempDir(id); flushQueue(); return;
    }

    t.status = 'completed'; t.progress = 1; t.speed = 0; t.eta = 0;
    t.bytesWritten = actualSize; t.totalBytes = actualSize;
    t.localUri = result.uri;
    notify(t); flushQueue();
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
      const delay = retryDelay(t._autoRetryCount);
      t.status = 'pending';
      t.error = `网络波动，${delay >= 1000 ? `${delay / 1000}s 后` : ''}自动续传中 (${t._autoRetryCount}/${MAX_AUTO_RETRY})...`;
      t.speed = 0; t.eta = -1;
      notify(t);
      const isReset = msg.includes('stream was reset') || msg.includes('CANCEL') || msg.includes('RST_STREAM');
      if (isReset) {
        await AsyncStorage.removeItem(resumeKey).catch(() => null);
        await cleanupTempDir(id);
        t.bytesWritten = 0; t.totalBytes = 0; t.progress = 0;
      }
      setTimeout(() => flushQueue(), delay);
      return;
    }

    t.status = 'failed'; t.error = mapErrorMessage(msg); notify(t);
    await AsyncStorage.removeItem(resumeKey).catch(() => null);
    await cleanupTempDir(id);
    flushQueue();
  }
}

async function startTask(id: string) {
  const task = tasks.get(id);
  if (!task) return;

  if (IS_WEB) {
    task.status = 'completed'; task.progress = 1;
    task.localUri = task.url;
    if (typeof window !== 'undefined') window.open(task.url, '_blank');
    notify(task); flushQueue(); return;
  }

  const fs = getFS();
  if (!fs) { task.status = 'failed'; task.error = '文件系统不可用'; notify(task); flushQueue(); return; }

  if (Platform.OS === 'android') {
    return startTaskAndroid(id);
  }
  return startTaskIOS(id);
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

  // iOS: expo-file-system session
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

  // iOS
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
      // iOS
      const session = activeSessions.get(id);
      if (session) { session?.cancelAsync?.().catch(() => {}); activeSessions.delete(id); }
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
      // Android 无断点，重置进度从头下
      if (Platform.OS === 'android') {
        task.progress = 0; task.bytesWritten = 0; task.totalBytes = 0;
      }
      notify(task);
    }
  }
  flushQueue();
}

export function clearAllTasks(): void {
  for (const [id] of tasks.entries()) {
    // iOS
    const session = activeSessions.get(id);
    if (session) { session?.cancelAsync?.().catch(() => {}); activeSessions.delete(id); }
    cleanupTempDir(id);
  }
  tasks.clear();
  speedSampler.clear();
  notifyRefresh();
}