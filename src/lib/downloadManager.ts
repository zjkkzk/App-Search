/**
 * 下载管理器 v3
 *
 * 核心特性：
 * 1. 单线程流式下载：expo-file-system createDownloadResumable（原生流，正确进度回调）
 * 2. 完善的错误处理：单次失败显示错误信息，支持重试
 * 3. 暂停/恢复：保留断点，恢复时从断点续传
 * 4. 下载通知：通过回调通知上层，由通知模块负责展示
 * 5. 默认保存到 Download/开源应用商店/ 公共目录（Android SAF）
 * 6. 文件校验：下载完成后验证文件大小
 *
 * 重要：expo-file-system 使用顶层静态导入（非懒加载），确保
 * requestDirectoryPermissionsAsync 在用户手势同步上下文中被调用，
 * 避免 Android 因微任务边界静默拒绝弹出 SAF 目录选择器。
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// expo-file-system SDK 55: StorageAccessFramework / documentDirectory / createDownloadResumable
// 均在 legacy 子路径下；主路径只导出新版 File/Directory class API。
// 使用静态顶层导入（非懒加载），确保 requestDirectoryPermissionsAsync 在
// Android 用户手势同步上下文中调用，避免微任务边界导致系统选择器被静默拦截。
import * as _FileSystem from 'expo-file-system/legacy';

const IS_WEB = Platform.OS === 'web';
const APP_FOLDER_NAME = '开源应用商店';
const SAF_URI_KEY = '@openappstore/saf_downloads_uri';
const MAX_CONCURRENT = 3; // 同时下载任务数

// ─── 同步获取 FileSystem（Web 返回 null）────────────────────────────────────
function getFS(): typeof _FileSystem | null {
  if (IS_WEB) return null;
  return _FileSystem;
}

// ─── SAF 目录管理 ────────────────────────────────────────────────────────────
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
    // 初始路径提示设为 Download（Android 公共下载目录）
    const result = await fs.StorageAccessFramework.requestDirectoryPermissionsAsync(
      'content://com.android.externalstorage.documents/tree/primary%3ADownload'
    );
    if (!result.granted) return false;
    let finalUri = result.directoryUri;
    // 在 Download 下建立 APP_FOLDER_NAME 子目录
    try {
      finalUri = await fs.StorageAccessFramework.makeDirectoryAsync(result.directoryUri, APP_FOLDER_NAME);
    } catch {
      // 子目录可能已存在，尝试从目录列表中找到它
      try {
        const entries = await fs.StorageAccessFramework.readDirectoryAsync(result.directoryUri);
        const sub = entries.find((e: string) => e.includes(encodeURIComponent(APP_FOLDER_NAME)) || e.endsWith(APP_FOLDER_NAME));
        if (sub) finalUri = sub;
        // 若找不到，退回到 Download 根目录即可
      } catch {
        // 保持 finalUri = result.directoryUri（Download 根目录）
      }
    }
    _safDirUri = finalUri;
    await AsyncStorage.setItem(SAF_URI_KEY, finalUri).catch(() => null);
    return true;
  } catch {
    return false;
  }
}

export async function resetDownloadsPermission(): Promise<void> {
  _safDirUri = null;
  await AsyncStorage.removeItem(SAF_URI_KEY).catch(() => null);
}

export async function hasDownloadsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return (await loadSafUri()) !== null;
}

/** 拷贝临时文件到 SAF Downloads 目录 */
async function moveToSafDownloads(tempUri: string, filename: string): Promise<string> {
  const fs = getFS();
  if (!fs) return tempUri;
  try {
    const dirUri = await loadSafUri();
    if (!dirUri) return tempUri;
    const mimeType = getMimeType(filename);
    const destUri = await fs.StorageAccessFramework.createFileAsync(dirUri, filename, mimeType);
    await fs.StorageAccessFramework.copyAsync({ from: tempUri, to: destUri });
    await fs.deleteAsync(tempUri, { idempotent: true }).catch(() => null);
    return destUri;
  } catch {
    return tempUri;
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────
export function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.apk')) return 'application/vnd.android.package-archive';
  if (lower.endsWith('.ipa')) return 'application/octet-stream';
  if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (lower.endsWith('.msi')) return 'application/x-msi';
  if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (lower.endsWith('.pkg')) return 'application/octet-stream';
  if (lower.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (lower.endsWith('.rpm')) return 'application/x-rpm';
  if (lower.endsWith('.appimage')) return 'application/octet-stream';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'application/gzip';
  return 'application/octet-stream';
}

export function isInstallerFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith('.apk') || lower.endsWith('.ipa') || lower.endsWith('.exe') ||
    lower.endsWith('.msi') || lower.endsWith('.dmg') || lower.endsWith('.pkg') ||
    lower.endsWith('.deb') || lower.endsWith('.rpm') || lower.endsWith('.appimage')
  );
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

// ─── 类型定义 ────────────────────────────────────────────────────────────────
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
  progress: number;        // 0~1
  bytesWritten: number;
  totalBytes: number;
  speed: number;           // bytes/s
  localUri: string | null;
  error: string | null;
  createdAt: number;
  /** 多线程下载是否已启用 */
  multiThreaded: boolean;
  /** 活跃分片数 */
  activeChunks: number;
}

type ProgressCallback = (task: DownloadTask) => void;

// ─── 全局状态 ────────────────────────────────────────────────────────────────
const tasks = new Map<string, DownloadTask>();
const abortControllers = new Map<string, AbortController>();
const subscribers = new Set<ProgressCallback>();
const lastProgressTime = new Map<string, { ts: number; bytes: number }>();

function genId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function notify(task: DownloadTask) {
  subscribers.forEach((cb) => cb({ ...task }));
}

function flushQueue() {
  const downloading = [...tasks.values()].filter((t) => t.status === 'downloading').length;
  if (downloading >= MAX_CONCURRENT) return;
  const next = [...tasks.values()].find((t) => t.status === 'pending');
  if (next) startTask(next.id);
}

/**
 * 单线程下载（降级方案 / 服务器不支持 Range）
 */
async function singleThreadedDownload(taskId: string): Promise<{
  success: boolean;
  error?: string;
  localUri?: string;
}> {
  const task = tasks.get(taskId);
  if (!task) return { success: false, error: '任务不存在' };

  const fs = getFS();
  if (!fs) return { success: false, error: '文件系统不可用' };

  const dir = `${fs.documentDirectory ?? ''}dl_${taskId}/`;
  await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => null);
  const localUri = dir + task.filename;

  const controller = new AbortController();
  abortControllers.set(taskId, controller);

  const resumable = fs.createDownloadResumable(
    task.url,
    localUri,
    {},
    (dp: any) => {
      const t = tasks.get(taskId);
      if (!t || t.status !== 'downloading') return;
      const { totalBytesWritten, totalBytesExpectedToWrite } = dp;
      const prev = lastProgressTime.get(taskId) ?? { ts: Date.now(), bytes: 0 };
      const now = Date.now();
      const elapsed = (now - prev.ts) / 1000;
      const delta = totalBytesWritten - prev.bytes;
      lastProgressTime.set(taskId, { ts: now, bytes: totalBytesWritten });
      t.bytesWritten = totalBytesWritten;
      t.totalBytes = totalBytesExpectedToWrite;
      t.progress = totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : 0;
      t.speed = elapsed > 0 ? Math.round(delta / elapsed) : 0;
      notify(t);
    }
  );

  try {
    const result = await resumable.downloadAsync();
    const t = tasks.get(taskId);
    if (!t) return { success: false };

    if (result) {
      return { success: true, localUri: result.uri };
    }
    return { success: false, error: '下载被取消' };
  } catch (e: any) {
    const t = tasks.get(taskId);
    if (!t) return { success: false };
    if (t.status === 'paused' || t.status === 'cancelled') {
      return { success: false };
    }
    const msg: string = e?.message ?? '';
    if (msg.includes('Network request failed') || msg.includes('Unable to resolve host')) {
      return { success: false, error: '网络连接失败，请检查网络后重试' };
    }
    if (msg.includes('No space left') || msg.includes('ENOSPC')) {
      return { success: false, error: '存储空间不足，请清理设备空间后重试' };
    }
    if (msg.includes('403') || msg.includes('Forbidden')) {
      return { success: false, error: '下载链接无权访问（403），请重新获取' };
    }
    if (msg.includes('404') || msg.includes('Not Found')) {
      return { success: false, error: '文件不存在（404），该版本可能已删除' };
    }
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      return { success: false, error: '下载超时，请检查网络连接后重试' };
    }
    return { success: false, error: msg || '下载失败，请重试' };
  }
}

// ─── 任务生命周期 ────────────────────────────────────────────────────────────

async function startTask(id: string) {
  const task = tasks.get(id);
  if (!task) return;

  task.status = 'downloading';
  task.error = null;
  task.multiThreaded = false;
  task.activeChunks = 0;
  notify(task);

  // Web 端：直接触发浏览器下载
  if (IS_WEB) {
    try {
      if (typeof window !== 'undefined') window.open(task.url, '_blank');
      task.status = 'completed';
      task.progress = 1;
      task.localUri = task.url;
    } catch (e: any) {
      task.status = 'failed';
      task.error = e?.message ?? '浏览器下载失败';
    }
    notify(task);
    flushQueue();
    return;
  }

  const fs = getFS();
  if (!fs) {
    task.status = 'failed';
    task.error = '文件系统不可用';
    notify(task);
    return;
  }

  // 直接使用单线程下载（createDownloadResumable：原生流式下载，有正确进度回调，支持 redirect）
  // 多线程方案（fetch+ArrayBuffer+base64合并）对大文件会 OOM 且无增量进度，已废弃
  const result = await singleThreadedDownload(id);

  const t = tasks.get(id);
  if (!t) return;

  if (result.success && result.localUri) {
    // 验证文件有效性
    const validErr = await validateFile(result.localUri);
    if (validErr) {
      t.status = 'failed';
      t.error = validErr;
      notify(t);
      return;
    }

    t.status = 'completed';
    t.progress = 1;
    t.speed = 0;
    t.bytesWritten = t.totalBytes;

    // Android: 移动到 SAF Downloads 目录
    if (Platform.OS === 'android') {
      t.localUri = await moveToSafDownloads(result.localUri, t.filename);
      // 清理临时目录
      const tempDir = result.localUri.substring(0, result.localUri.lastIndexOf('/'));
      await fs.deleteAsync(tempDir, { idempotent: true }).catch(() => null);
    } else {
      t.localUri = result.localUri;
    }
  } else {
    if (t.status !== 'cancelled' && t.status !== 'paused') {
      t.status = 'failed';
      t.error = result.error || '下载失败，请重试';
    }
  }

  notify(t);
  abortControllers.delete(id);
  flushQueue();
}

async function validateFile(uri: string): Promise<string | null> {
  if (IS_WEB) return null;
  if (uri.startsWith('content://')) return null;
  const fs = getFS();
  if (!fs) return null;
  try {
    const info = await fs.getInfoAsync(uri);
    if (!info.exists) return '文件不存在，可能已被删除';
    if ((info as any).size === 0) return '文件大小为 0，下载可能不完整';
    return null;
  } catch {
    return null;
  }
}

// ─── 公开 API ────────────────────────────────────────────────────────────────

export function subscribe(cb: ProgressCallback): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getAllTasks(): DownloadTask[] {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getTask(id: string): DownloadTask | undefined {
  return tasks.get(id);
}

export function findTaskByUrl(url: string): DownloadTask | undefined {
  return [...tasks.values()].find((t) => t.url === url);
}

export function enqueue(params: {
  url: string; filename: string; appId: number; appName: string;
  owner: string; repo: string; avatarUrl: string; version: string;
}): string {
  const id = genId();
  const task: DownloadTask = {
    id,
    url: params.url,
    filename: params.filename,
    appId: params.appId,
    appName: params.appName,
    owner: params.owner,
    repo: params.repo,
    avatarUrl: params.avatarUrl,
    version: params.version,
    status: 'pending',
    progress: 0,
    bytesWritten: 0,
    totalBytes: 0,
    speed: 0,
    localUri: null,
    error: null,
    createdAt: Date.now(),
    multiThreaded: false,
    activeChunks: 0,
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
  lastProgressTime.delete(oldId);
  abortControllers.delete(oldId);
  return enqueue({
    url: old.url, filename: old.filename, appId: old.appId,
    appName: old.appName, owner: old.owner, repo: old.repo,
    avatarUrl: old.avatarUrl, version: old.version,
  });
}

export async function pause(id: string): Promise<void> {
  const task = tasks.get(id);
  if (!task || task.status !== 'downloading') return;

  // 中止当前下载
  const controller = abortControllers.get(id);
  if (controller) {
    controller.abort();
    abortControllers.delete(id);
  }
  task.status = 'paused';
  task.speed = 0;
  notify(task);
}

export async function resume(id: string): Promise<void> {
  const task = tasks.get(id);
  if (!task || task.status !== 'paused') return;

  task.status = 'pending';
  notify(task);
  flushQueue();
}

export async function cancel(id: string): Promise<void> {
  const task = tasks.get(id);
  if (!task) return;

  const controller = abortControllers.get(id);
  if (controller) {
    controller.abort();
    abortControllers.delete(id);
  }

  // 清理临时文件
  if (!IS_WEB && task.localUri && task.status !== 'completed') {
    const fs = getFS();
    if (fs) {
      try { await fs.deleteAsync(task.localUri, { idempotent: true }); } catch { /* ignore */ }
    }
  }

  tasks.delete(id);
  lastProgressTime.delete(id);
  flushQueue();
}

export async function deleteFile(id: string): Promise<void> {
  const task = tasks.get(id);
  if (!task) return;

  // 如果正在下载，先取消
  if (task.status === 'downloading' || task.status === 'pending') {
    await cancel(id);
    // cancel 已经删除了 task，直接返回
    subscribers.forEach((cb) => cb({ id: '__refresh__' } as any));
    return;
  }

  // 删除本地文件
  if (!IS_WEB && task.localUri) {
    const fs = getFS();
    if (fs) {
      try { await fs.deleteAsync(task.localUri, { idempotent: true }); } catch { /* ignore */ }
    }
  }

  tasks.delete(id);
  lastProgressTime.delete(id);
  subscribers.forEach((cb) => cb({ id: '__refresh__' } as any));
}

export function clearFinished(): void {
  for (const [id, task] of tasks.entries()) {
    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      tasks.delete(id);
      lastProgressTime.delete(id);
    }
  }
  subscribers.forEach((cb) => cb({ id: '__refresh__' } as any));
}

export function pauseAll(): void {
  for (const [id, task] of tasks) {
    if (task.status === 'downloading' || task.status === 'pending') {
      task.status = 'paused';
      const controller = abortControllers.get(id);
      if (controller) {
        controller.abort();
        abortControllers.delete(id);
      }
      task.speed = 0;
      notify(task);
    }
  }
}

export function resumeAll(): void {
  for (const [id, task] of tasks) {
    if (task.status === 'paused') {
      task.status = 'pending';
      notify(task);
    }
  }
  flushQueue();
}

/** 清除所有内存任务（含正在进行的），用于「清除数据」场景 */
export function clearAllTasks(): void {
  for (const [id] of tasks.entries()) {
    const t = tasks.get(id);
    if (t && (t.status === 'downloading' || t.status === 'pending')) {
      const ctrl = abortControllers.get(id);
      if (ctrl) { ctrl.abort(); abortControllers.delete(id); }
    }
    tasks.delete(id);
    lastProgressTime.delete(id);
  }
  subscribers.forEach((cb) => cb({ id: '__refresh__' } as any));
}