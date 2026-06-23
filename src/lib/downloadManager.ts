/**
 * 下载管理器 v23 — 断点续传 + 弱网优化
 *
 * 引擎：
 *  - Android/iOS : expo-file-system createDownloadResumable（应用内下载，进度可追踪）
 *  - Web         : window.open() 交给浏览器
 *
 * 存储策略：
 *  - 下载至 documentDirectory/dl_${id}/ 临时目录
 *  - 完成后 moveAsync → dl_perm/${filename}（持久目录）
 *  - Android 额外 SAF 复制到公共 Downloads 目录（/storage/emulated/0/Download/）
 *  - Android 通过 FileProvider getContentUriAsync 暴露给安装器
 *  - iOS 通过 shareAsync 暴露给安装器
 *
 * 断点续传：
 *  - iOS：NSURLSessionDownloadTask 字节级续传，resumeData 以 URL 为 key 持久化
 *         → 跨会话（App 重启后）可从断点恢复
 *  - Android：保存已下载字节数至 AsyncStorage（key = URL hash），重试时展示已缓存进度
 *             注：expo-file-system 在 Android 上不支持字节级续传（OkHttp 不保留分段文件）
 *
 * 预检（HEAD 请求）：
 *  - 下载前发 HEAD 获取 Content-Length（提前展示文件大小）
 *  - 检测服务器是否支持 Range，为将来原生模块集成做标记
 *
 * 弱网优化：
 *  - 卡顿检测 30s（↓ 旧版 60s）
 *  - 最大自动重试 8 次（↑ 旧版 5 次）
 *  - 指数退避 + ±30% 随机抖动（避免雷群效应）
 *  - isTransientError 扩展覆盖更多弱网错误码
 *
 * v23 修复点（延续 v22）：
 *  5. enqueue 对 completed 任务执行 delete+create → 意外重新下载 → 改为直接返回 existing.id
 *  6. 断点续传 key 从 task ID 改为 URL hash → 跨会话可恢复 iOS 续传数据
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as _FileSystem from 'expo-file-system/legacy';

const IS_WEB = Platform.OS === 'web';
const IS_ANDROID = Platform.OS === 'android';
const IS_IOS = Platform.OS === 'ios';
const MAX_CONCURRENT = 3;
const PERM_DIR_NAME = 'dl_perm';
const MAX_AUTO_RETRY = 8;          // 弱网下更多重试机会（旧版 5 次）
const STALL_INTERVAL_MS = 30_000;  // 卡顿检测缩短至 30s（旧版 60s），弱网更快响应
const RESUME_KEY_PREFIX = '@openappstore/resume_';
const PARTIAL_KEY_PREFIX = '@openappstore/partial_'; // Android 已下载字节数缓存
const SAF_PERM_KEY = '@openappstore/saf_downloads_uri';

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
/** 活跃的 expo-file-system DownloadResumable */
const activeSessions = new Map<string, _FileSystem.DownloadResumable>();
const speedSampler = new Map<string, { ts: number; bytes: number }>();
/**
 * 正在"启动中"的任务 ID 集合（已调用 startTask 但 DownloadResumable 尚未建立）
 * 用于防止 flushQueue 在 probeDownloadUrl 等异步初始化期间重复启动同一任务（BUG-A 修复）
 */
const launchingSet = new Set<string>();

function genId(): string { return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
function notify(task: DownloadTask) { subscribers.forEach((cb) => cb({ ...task })); }
function notifyRefresh() { subscribers.forEach((cb) => cb({ id: REFRESH_EVENT })); }

function flushQueue() {
  const active = [...tasks.values()].filter((t) => t.status === 'downloading').length;
  if (active >= MAX_CONCURRENT) return;
  // launchingSet 中的任务已调用 startTask 但 DownloadResumable 尚未建立（正在做预检等异步初始化）
  // 不计入 active count，但也不能重复启动（BUG-A 修复）
  const next = [...tasks.values()].find(
    (t) => t.status === 'pending' && !launchingSet.has(t.id),
  );
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
    // 弱网扩展：SSL 握手失败、链路重置、管道错误（4G/WiFi 切换时高发）
    msg.includes('SSLException') ||
    msg.includes('SSLHandshakeException') ||
    msg.includes('handshake') ||
    msg.includes('Broken pipe') ||
    msg.includes('EPIPE') ||
    msg.includes('Software caused connection abort') ||
    msg.includes('Connection reset by peer') ||
    msg.includes('No route to host') ||
    msg.includes('EHOSTUNREACH') ||
    msg.includes('ENETUNREACH') ||
    msg.includes('Network is unreachable') ||
    msg.includes('Host is unreachable') ||
    // GitHub CDN 限速/过载（临时）
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('Too Many Requests') ||
    msg.includes('Service Unavailable') ||
    // 弱网扩展：502/504 网关超时（CDN 边缘节点过载）
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('Bad Gateway') ||
    msg.includes('Gateway Timeout')
  );
}

/**
 * 计算第 n 次重试的退避延迟（指数退避 + ±30% 随机抖动，上限 30s）
 * 抖动避免多任务同时重试时的"雷群效应"
 */
function retryDelay(retryCount: number): number {
  const base = Math.min(30_000, 1_000 * (2 ** retryCount));
  const jitter = Math.floor(Math.random() * base * 0.3);
  return base + jitter;
}

/**
 * 下载预检：发送 HEAD 请求获取文件大小和 Range 支持情况
 * - 用于下载开始前预填 totalBytes，让进度条从 0% 起就能显示文件大小
 * - 检测服务器是否支持 Accept-Ranges: bytes（为 Android 断点续传做标记）
 * - 任何失败均静默忽略，不阻断下载流程
 */
async function probeDownloadUrl(url: string): Promise<{ contentLength: number; acceptsRange: boolean }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000); // 8s 超时，避免阻塞下载启动
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'OpenAppStore/1.0' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10) || 0;
    const acceptsRange = (res.headers.get('accept-ranges') ?? '').toLowerCase() === 'bytes';
    return { contentLength, acceptsRange };
  } catch {
    return { contentLength: 0, acceptsRange: false };
  }
}

/**
 * 将 URL 映射为稳定的 AsyncStorage key 后缀（不依赖 task ID）
 * 用于 iOS resumeData 跨会话持久化：App 重启后新 task 可通过 URL 找到旧 resumeData
 */
function urlStableKey(url: string): string {
  // 取 URL 末尾 100 字符并替换非法字符，保证唯一性同时控制 key 长度
  return url.replace(/[^a-zA-Z0-9]/g, '_').slice(-100);
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

/**
 * Android：通过 StorageAccessFramework 把文件复制到公共 Downloads 目录。
 * - 首次调用弹出目录选择器（预选 Downloads），用户授权后 URI 持久化
 * - 后续调用直接用已缓存 URI，无需再次授权
 * - 任何错误均静默忽略（不影响主下载流程）
 */
async function copyToPublicDownloads(localUri: string, filename: string): Promise<void> {
  if (!IS_ANDROID) return;
  try {
    const SAF = _FileSystem.StorageAccessFramework;
    if (!SAF) return;

    // 读取或申请授权
    let dirUri = await AsyncStorage.getItem(SAF_PERM_KEY).catch(() => null);
    if (!dirUri) {
      // 预选到 Downloads 目录，用户点允许即可
      const result = await SAF.requestDirectoryPermissionsAsync(
        'content://com.android.externalstorage.documents/tree/primary%3ADownload',
      );
      if (!result.granted) return; // 用户拒绝，静默跳过
      dirUri = result.directoryUri;
      await AsyncStorage.setItem(SAF_PERM_KEY, dirUri).catch(() => null);
    }

    // 在 Downloads 目录创建文件（同名自动覆盖：先删后建）
    const existingFiles = await SAF.readDirectoryAsync(dirUri).catch(() => [] as string[]);
    for (const existingUri of existingFiles) {
      const existingName = decodeURIComponent(existingUri.split('%2F').pop() ?? '');
      if (existingName === filename) {
        await SAF.deleteAsync(existingUri).catch(() => null);
        break;
      }
    }
    const mimeType = getMimeType(filename);
    const newFileUri = await SAF.createFileAsync(dirUri, filename, mimeType);

    // 用 copyAsync 直接复制，避免 readAsStringAsync 把整个大文件读入内存导致 OOM
    await _FileSystem.copyAsync({ from: localUri, to: newFileUri });
  } catch {
    // 复制失败不阻断主流程，安装包依然可从内部目录安装
  }
}

// ─── 核心下载逻辑 ─────────────────────────────────────────────────────────────

/** 通用进度更新（Android / iOS 均复用） */
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

/**
 * 应用内下载（Android + iOS 统一）
 *
 * 断点续传策略：
 *  - iOS：resumeData 以 URL 为 key 存入 AsyncStorage
 *         → 跨会话恢复：App 重启后重新入队同 URL，可从上次断点继续
 *  - Android：expo-file-system 不支持字节级续传
 *             下载前保存 { bytesWritten, totalBytes } 到 AsyncStorage（key = URL hash）
 *             重试时读取并预填进度条，提升弱网下的体验感知
 *
 * 预检：
 *  - 下载前发 HEAD 请求获取 Content-Length，让进度条从第一帧就能展示文件大小
 */
async function startTaskNative(id: string) {
  const task = tasks.get(id);
  if (!task) return;
  // 防重入①：activeSessions 已存在 → DownloadResumable 已建立，直接忽略
  if (activeSessions.has(id)) return;
  // 防重入②：launchingSet 已登记 → 正在初始化中（probeDownloadUrl 等），直接忽略（BUG-A 修复）
  if (launchingSet.has(id)) return;

  // ── 立即将 status 设为 'downloading' 并加入 launchingSet ────────────────────
  // 必须在任何 await 之前完成，确保 flushQueue 不会在异步初始化期间重复选中此任务
  // 旧版在 probeDownloadUrl（最长 8s）之后才改 status，导致 flushQueue 反复重启同一下载
  launchingSet.add(id);
  task.status = 'downloading';
  task.error = null;
  task.speed = 0;
  task.eta = -1;
  notify(task);

  const fs = getFS()!;
  const tempDir = `${fs.documentDirectory ?? ''}dl_${id}/`;
  const localUri = `${tempDir}${task.filename}`;

  // resumeData key 以 URL 为索引（而非 task ID），确保 App 重启后仍可找到旧续传数据
  const resumeKey = `${RESUME_KEY_PREFIX}${urlStableKey(task.url)}`;
  // Android：已下载字节数缓存 key（用于展示进度，不用于真正续传）
  const partialKey = `${PARTIAL_KEY_PREFIX}${urlStableKey(task.url)}`;

  await fs.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => null);

  // ── 预检 + resumeData 加载（并行） ────────────────────────────────────────
  const [probeResult, resumeDataRaw] = await Promise.all([
    probeDownloadUrl(task.url),
    (async () => {
      if (!IS_IOS) return null;
      try {
        const saved = await AsyncStorage.getItem(resumeKey);
        if (!saved) return null;
        const info = await fs.getInfoAsync(localUri).catch(() => ({ exists: false }));
        if (!info.exists) {
          await AsyncStorage.removeItem(resumeKey).catch(() => null);
          return null;
        }
        return saved;
      } catch { return null; }
    })(),
  ]);

  // 预填 totalBytes（若 HEAD 成功）
  if (probeResult.contentLength > 0 && task.totalBytes === 0) {
    task.totalBytes = probeResult.contentLength;
  }

  // Android：读取上次下载的进度并预填（仅展示，不影响真实下载）
  if (IS_ANDROID && task.bytesWritten === 0) {
    try {
      const saved = await AsyncStorage.getItem(partialKey);
      if (saved) {
        const { bytesWritten: bw, totalBytes: tb } = JSON.parse(saved);
        if (typeof bw === 'number' && bw > 0) {
          task.bytesWritten = bw;
          if (typeof tb === 'number' && tb > task.totalBytes) task.totalBytes = tb;
          task.progress = task.totalBytes > 0 ? bw / task.totalBytes : -1;
        }
      }
    } catch { /* ignore */ }
  }

  const resumeData: string | undefined = resumeDataRaw ?? undefined;

  // Android 不用 resumeData，清除可能残留的旧数据
  if (IS_ANDROID) {
    await AsyncStorage.removeItem(resumeKey).catch(() => null);
  }

  // 进度/字节数重置（resumeData 存在时保留已有进度）
  if (!resumeData) {
    task.progress = IS_IOS ? task.progress : 0;
    task.bytesWritten = IS_IOS ? task.bytesWritten : 0;
    if (!IS_IOS) task.totalBytes = probeResult.contentLength || 0;
  }
  notify(task);

  let resumableRef: _FileSystem.DownloadResumable | null = null;

  const resumable = fs.createDownloadResumable(
    task.url, localUri,
    { headers: { 'User-Agent': 'OpenAppStore/1.0' } },
    (dp: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
      applyProgress(id, dp.totalBytesWritten, dp.totalBytesExpectedToWrite);

      // iOS：首次有进度立即保存断点，之后每 3s 保存一次（key = URL hash）
      if (IS_IOS) {
        const now = Date.now();
        const isFirst = lastSaveTs === 0 && dp.totalBytesWritten > 0;
        if ((isFirst || now - lastSaveTs > 3_000) && resumableRef) {
          lastSaveTs = now;
          try {
            const state = resumableRef.savable();
            if (state.resumeData) {
              AsyncStorage.setItem(resumeKey, JSON.stringify(state.resumeData)).catch(() => null);
            }
          } catch { /* ignore */ }
        }
      }

      // Android：每 5s 保存已下载字节数（供重启后展示）
      if (IS_ANDROID) {
        const now = Date.now();
        if (now - lastAndroidSaveTs > 5_000 && dp.totalBytesWritten > 0) {
          lastAndroidSaveTs = now;
          AsyncStorage.setItem(partialKey, JSON.stringify({
            bytesWritten: dp.totalBytesWritten,
            totalBytes: dp.totalBytesExpectedToWrite,
          })).catch(() => null);
        }
      }
    },
    resumeData ? JSON.parse(resumeData) : undefined,
  );
  resumableRef = resumable;
  let lastSaveTs = 0;
  let lastAndroidSaveTs = 0;
  activeSessions.set(id, resumable);
  launchingSet.delete(id); // DownloadResumable 已建立，移出启动集合

  // ── 卡顿检测：STALL_INTERVAL_MS（30s）无新字节 → 取消并重试 ─────────────
  // lastStallBytes 初始化为当前已写字节数（而非 0），避免首轮必过、掩盖即时卡顿
  let lastStallBytes = task.bytesWritten;
  const stallTimer = setInterval(() => {
    const t = tasks.get(id);
    if (!t || t.status !== 'downloading') { clearInterval(stallTimer); return; }

    // BUG-B 修复：文件写入最后阶段进度回调可能停止，但下载实际已完成
    // 当 bytesWritten 已达 totalBytes 的 99.9% 以上时，视为"即将完成"，跳过卡顿中断
    // 避免误杀最后字节 → 导致重新从头下载
    if (t.totalBytes > 0 && t.bytesWritten >= t.totalBytes * 0.999) {
      clearInterval(stallTimer);
      return;
    }

    if (t.bytesWritten === lastStallBytes) {
      clearInterval(stallTimer);
      // iOS：保存断点以便下次续传
      if (IS_IOS) {
        try {
          const state = resumableRef?.savable();
          if (state?.resumeData) {
            AsyncStorage.setItem(resumeKey, JSON.stringify(state.resumeData)).catch(() => null);
          }
        } catch { /* ignore */ }
      }
      activeSessions.get(id)?.cancelAsync?.().catch(() => {});
      activeSessions.delete(id);
      speedSampler.delete(id); // 清除速度采样，避免续传后速度计算异常
      if ((t._autoRetryCount ?? 0) < MAX_AUTO_RETRY) {
        t._autoRetryCount = (t._autoRetryCount ?? 0) + 1;
        t.status = 'pending';
        t.error = `网络中断，自动重试 (${t._autoRetryCount}/${MAX_AUTO_RETRY})...`;
        t.speed = 0; t.eta = -1;
        notify(t);
        setTimeout(() => flushQueue(), 2_000);
      } else {
        t.status = 'failed';
        t.error = '下载超时，请检查网络后手动重试';
        if (!IS_IOS) AsyncStorage.removeItem(resumeKey).catch(() => null);
        cleanupTempDir(id);
        notify(t);
        flushQueue();
      }
    } else { lastStallBytes = t.bytesWritten; }
  }, STALL_INTERVAL_MS);

  try {
    const result = await resumable.downloadAsync();
    clearInterval(stallTimer);
    activeSessions.delete(id);
    launchingSet.delete(id);
    speedSampler.delete(id);
    resumableRef = null;
    // 下载完成，清除两种续传缓存
    await Promise.all([
      AsyncStorage.removeItem(resumeKey).catch(() => null),
      AsyncStorage.removeItem(partialKey).catch(() => null),
    ]);

    const t = tasks.get(id);
    if (!t) return;
    if (!result) {
      // downloadAsync 返回 null = 被外部取消（stall/pause/cancel）
      // stall 已将 status 置为 pending，直接放行让 flushQueue 重启
      if (t.status !== 'downloading') { flushQueue(); return; }
      // 意外的 null（未知原因中断）
      t.status = 'failed'; t.error = '下载中断，请重试'; notify(t);
      flushQueue(); return;
    }

    // 验证文件大小非零
    const info = await fs.getInfoAsync(result.uri).catch(() => ({ exists: false }));
    const actualSize: number = info.exists ? ((info as any).size ?? 0) : 0;
    if (actualSize === 0) {
      t.status = 'failed'; t.error = '下载文件大小为 0，请重试'; notify(t);
      await cleanupTempDir(id); flushQueue(); return;
    }

    // 移入持久目录（Android FileProvider / iOS shareAsync 均可访问）
    try {
      const permUri = await moveToPermanentStorage(result.uri, t.filename);
      t.localUri = permUri;
      // Android：额外复制到公共 Downloads（不阻断主流程）
      if (IS_ANDROID) copyToPublicDownloads(permUri, t.filename);
    } catch {
      // 移动失败则保留临时目录路径（安装仍可使用）
      t.localUri = result.uri;
    }
    // 清理临时目录（若文件已成功移走）
    if (t.localUri !== result.uri) {
      await cleanupTempDir(id);
    }

    t.status = 'completed'; t.progress = 1; t.speed = 0; t.eta = 0;
    t.bytesWritten = actualSize; t.totalBytes = actualSize;
    t.error = null;
    notify(t); flushQueue();
  } catch (e: any) {
    clearInterval(stallTimer);
    activeSessions.delete(id);
    launchingSet.delete(id);
    speedSampler.delete(id);
    resumableRef = null;

    const t = tasks.get(id);
    if (!t) { flushQueue(); return; }
    // stall 处理器已将 status 置为 pending/paused/cancelled，catch 不再重复重试
    if (t.status !== 'downloading') { flushQueue(); return; }

    const msg: string = e?.message ?? '';
    if (isTransientError(msg) && (t._autoRetryCount ?? 0) < MAX_AUTO_RETRY) {
      t._autoRetryCount = (t._autoRetryCount ?? 0) + 1;
      const delay = retryDelay(t._autoRetryCount);
      t.status = 'pending';
      t.error = `网络波动，${delay >= 1000 ? `${Math.round(delay / 1000)}s 后` : ''}自动重试 (${t._autoRetryCount}/${MAX_AUTO_RETRY})...`;
      t.speed = 0; t.eta = -1;
      notify(t);
      // RST_STREAM 类错误清除 resumeData，从头下（连接被服务端强制重置，续传数据无效）
      const isReset = msg.includes('stream was reset') || msg.includes('CANCEL') || msg.includes('RST_STREAM');
      if (isReset) {
        await AsyncStorage.removeItem(resumeKey).catch(() => null);
        await cleanupTempDir(id);
        t.bytesWritten = 0; t.totalBytes = probeResult.contentLength || 0; t.progress = 0;
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

  return startTaskNative(id);
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
  // 已存在且非终态（进行中/已完成）→ 直接返回，不重复下载
  // fix(v23): 旧版将 completed 纳入删除+重建逻辑，导致完成后被意外重新下载
  if (existing && ['pending', 'downloading', 'paused', 'completed'].includes(existing.status)) {
    return existing.id;
  }
  // 仅 failed/cancelled 才允许重建（相当于重试）
  if (existing) {
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

  const session = activeSessions.get(id);
  if (session) {
    // BUG-C 修复：iOS 暂停时先保存断点，再取消 session，否则 resumeData 丢失
    if (IS_IOS) {
      try {
        const state = session.savable();
        const resumeKey = `${RESUME_KEY_PREFIX}${urlStableKey(task.url)}`;
        if (state.resumeData) {
          await AsyncStorage.setItem(resumeKey, JSON.stringify(state.resumeData)).catch(() => null);
        }
      } catch { /* ignore */ }
    }
    session.cancelAsync?.().catch(() => {});
    activeSessions.delete(id);
  }
  launchingSet.delete(id);

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
  launchingSet.delete(id);

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

  if (!IS_WEB) {
    const fs = getFS();
    if (fs) {
      // 删除持久目录中的文件
      if (task.localUri) await fs.deleteAsync(task.localUri, { idempotent: true }).catch(() => null);
      // 清理临时下载目录（防止文件移动失败时残留）
      await cleanupTempDir(id);
    }
  }

  tasks.delete(id);
  speedSampler.delete(id);
  notifyRefresh();
}

export function clearFinished(): void {
  const fs = IS_WEB ? null : getFS();
  for (const [id, task] of tasks.entries()) {
    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      // 同步删除磁盘文件（fire-and-forget）
      if (fs && task.localUri) fs.deleteAsync(task.localUri, { idempotent: true }).catch(() => null);
      if (fs) cleanupTempDir(id);
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
        // BUG-C 修复：批量暂停时同样保存 iOS 断点
        if (IS_IOS) {
          try {
            const state = session.savable();
            const resumeKey = `${RESUME_KEY_PREFIX}${urlStableKey(task.url)}`;
            if (state.resumeData) {
              AsyncStorage.setItem(resumeKey, JSON.stringify(state.resumeData)).catch(() => null);
            }
          } catch { /* ignore */ }
        }
        session.cancelAsync?.().catch(() => {});
        activeSessions.delete(id);
      }
      launchingSet.delete(id);
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
    if (session) { session?.cancelAsync?.().catch(() => {}); activeSessions.delete(id); }
    launchingSet.delete(id);
    cleanupTempDir(id);
  }
  tasks.clear();
  speedSampler.clear();
  notifyRefresh();
}