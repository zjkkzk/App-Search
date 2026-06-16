/**
 * Local user-behaviour event recorder.
 * Events are stored on-device (same localStorage / SQLite strategy as database.ts).
 * They feed local "my stats" and can later be bulk-uploaded to Supabase.
 *
 * Event types:
 *   search   – keyword searched
 *   view     – app detail page opened
 *   download – install asset downloaded
 *   favorite – app added to / removed from favorites
 */

import { Platform } from 'react-native'

export type EventType = 'search' | 'view' | 'download' | 'favorite'

export interface AppEvent {
  id: string
  event_type: EventType
  app_id?: number
  app_name?: string
  keyword?: string
  platform?: string        // 'android' | 'ios' | 'windows' | ...
  created_at: number       // unix ms
}

const IS_WEB = Platform.OS === 'web'
const STORAGE_KEY = 'oas_events'
const MAX_EVENTS   = 500   // keep only the latest N to avoid unbounded growth

// ─── Web helpers (localStorage) ──────────────────────────────────────────────
function webReadAll(): AppEvent[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
function webWriteAll(events: AppEvent[]) {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
  } catch { /* ignore */ }
}

// ─── Native helpers (SQLite via lazy init in database.ts) ─────────────────────
// For simplicity we use AsyncStorage on native – same dep already in package.json.
let _AS: typeof import('@react-native-async-storage/async-storage').default | null = null
async function getAS() {
  if (!IS_WEB && !_AS)
    _AS = (await import('@react-native-async-storage/async-storage')).default
  return _AS
}
async function nativeReadAll(): Promise<AppEvent[]> {
  try {
    const AS = await getAS()
    const raw = await AS?.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
async function nativeWriteAll(events: AppEvent[]): Promise<void> {
  try {
    const AS = await getAS()
    await AS?.setItem(STORAGE_KEY, JSON.stringify(events))
  } catch { /* ignore */ }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Record a single user-behaviour event. Fire-and-forget safe. */
export async function addAppEvent(event: Omit<AppEvent, 'id' | 'created_at'>): Promise<void> {
  try {
    const newEvent: AppEvent = {
      ...event,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      created_at: Date.now(),
    }
    if (IS_WEB) {
      const all = webReadAll()
      all.unshift(newEvent)
      webWriteAll(all.slice(0, MAX_EVENTS))
    } else {
      const all = await nativeReadAll()
      all.unshift(newEvent)
      await nativeWriteAll(all.slice(0, MAX_EVENTS))
    }
  } catch { /* never throw */ }
}

/** Returns all stored events (newest first). */
export async function getAllEvents(): Promise<AppEvent[]> {
  if (IS_WEB) return webReadAll()
  return nativeReadAll()
}

/** Returns counts grouped by event_type. */
export async function getEventCounts(): Promise<Record<EventType, number>> {
  const counts: Record<EventType, number> = { search: 0, view: 0, download: 0, favorite: 0 }
  const all = await getAllEvents()
  for (const e of all) counts[e.event_type] = (counts[e.event_type] || 0) + 1
  return counts
}

/**
 * Returns the top-N most-viewed / most-downloaded apps from local events.
 * Useful for a "my trending" section.
 */
export async function getTopApps(
  eventType: EventType,
  limit = 10
): Promise<{ app_id: number; app_name: string; count: number }[]> {
  const all = await getAllEvents()
  const map = new Map<number, { app_name: string; count: number }>()
  for (const e of all) {
    if (e.event_type !== eventType || !e.app_id) continue
    const prev = map.get(e.app_id)
    map.set(e.app_id, { app_name: e.app_name ?? '', count: (prev?.count ?? 0) + 1 })
  }
  return Array.from(map.entries())
    .map(([app_id, v]) => ({ app_id, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/** Clear all local events (e.g. from settings). */
export async function clearAllEvents(): Promise<void> {
  if (IS_WEB) { webWriteAll([]); return }
  const AS = await getAS()
  await AS?.removeItem(STORAGE_KEY)
}
