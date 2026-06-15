// Web 平台：纯 localStorage 实现，完全不引用 expo-sqlite
import type { AppItem, DownloadRecord, FavoriteItem } from '@/types';

function webGet<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function webSet(key: string, value: unknown) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ─── 收藏 ────────────────────────────────────────────────────────────────────
export async function addFavorite(app: AppItem): Promise<void> {
  const favs = webGet<FavoriteItem[]>('oas_favorites', []);
  if (favs.find((f) => f.app_id === app.id)) return;
  favs.unshift({
    id: String(Date.now()), app_id: app.id, app_name: app.name,
    owner: app.owner, repo: app.repo, avatar_url: app.avatar_url,
    description: app.description, stars: app.stars, language: app.language,
    platforms: app.platforms, tags: app.topics || [],
    group_name: '全部收藏', added_at: new Date().toISOString(),
  });
  webSet('oas_favorites', favs);
}

export async function removeFavorite(appId: number): Promise<void> {
  const favs = webGet<FavoriteItem[]>('oas_favorites', []).filter((f) => f.app_id !== appId);
  webSet('oas_favorites', favs);
}

export async function isFavorite(appId: number): Promise<boolean> {
  return webGet<FavoriteItem[]>('oas_favorites', []).some((f) => f.app_id === appId);
}

export async function getFavorites(): Promise<FavoriteItem[]> {
  return webGet<FavoriteItem[]>('oas_favorites', []);
}

export async function getFavoriteStats(): Promise<{ total: number }> {
  return { total: webGet<FavoriteItem[]>('oas_favorites', []).length };
}

// ─── 下载记录 ───────────────────────────────────────────────────────────────
export async function addDownloadRecord(record: Omit<DownloadRecord, 'id'>): Promise<void> {
  const list = webGet<DownloadRecord[]>('oas_downloads', []);
  list.unshift({ ...record, id: String(Date.now()) });
  webSet('oas_downloads', list.slice(0, 100));
}

export async function getDownloadHistory(): Promise<DownloadRecord[]> {
  return webGet<DownloadRecord[]>('oas_downloads', []);
}

export async function clearDownloadHistory(): Promise<void> {
  webSet('oas_downloads', []);
}

// ─── 搜索历史 ───────────────────────────────────────────────────────────────
export async function addSearchHistory(keyword: string): Promise<void> {
  const list = webGet<string[]>('oas_search_history', []);
  const filtered = list.filter((k) => k !== keyword);
  webSet('oas_search_history', [keyword, ...filtered].slice(0, 20));
}

export async function getSearchHistory(): Promise<string[]> {
  return webGet<string[]>('oas_search_history', []);
}

export async function clearSearchHistory(): Promise<void> {
  webSet('oas_search_history', []);
}
