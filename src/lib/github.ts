import { supabase } from '@/client/supabase'
import type { AppItem, GitHubRelease, InstallableCheckResult } from '@/types'

let cachedToken: string | null = null

export async function setGitHubToken(token: string | null) {
  cachedToken = token
}

export async function getGitHubToken(): Promise<string | null> {
  return cachedToken
}

/** 从 supabase.functions.invoke 的 error 中提取可读错误信息 */
async function extractErrorMessage(error: any): Promise<string> {
  try {
    const raw = await error?.context?.text?.()
    if (raw) {
      const parsed = JSON.parse(raw)
      // Edge Function 返回: { error, details } 或 { message }
      if (parsed?.details) return String(parsed.details)
      if (parsed?.error) return String(parsed.error)
      if (parsed?.message) return String(parsed.message)
      return raw
    }
  } catch { /* ignore parse errors */ }
  return error?.message || '请求失败，请稍后重试'
}

export async function searchRepos(
  q: string,
  options: { sort?: string; order?: string; page?: number; per_page?: number; installableOnly?: boolean } = {}
): Promise<{ items: AppItem[]; total_count: number }> {
  const query = normalizeStoreQuery(q)
  const { data, error } = await supabase.functions.invoke('github-proxy', {
    body: {
      action: 'search',
      params: { q: query, sort: options.sort || 'stars', order: options.order || 'desc', page: options.page || 1, per_page: options.per_page || 30 },
      token: cachedToken,
    },
  })
  if (error) {
    const msg = await extractErrorMessage(error)
    throw new Error(msg)
  }
  const items = (data.data?.items || []).map((item: any) => mapRepoToApp(item))
  if (options.installableOnly && items.length > 0) {
    const checkedItems = await enrichInstallableApps(items)
    // 防止批量校验接口未部署、GitHub 限流或查询过窄导致页面全空；有校验结果时优先展示可安装应用，否则回退到搜索结果。
    if (checkedItems.length > 0) {
      return { items: checkedItems, total_count: data.data?.total_count || 0 }
    }
  }
  return { items, total_count: data.data?.total_count || 0 }
}

async function enrichInstallableApps(items: AppItem[]): Promise<AppItem[]> {
  try {
    const repos = items.slice(0, 20).map((item) => ({ owner: item.owner, repo: item.repo }))
    const { data, error } = await supabase.functions.invoke('github-proxy', {
      body: {
        action: 'check_installable_batch',
        params: { repos },
        token: cachedToken,
      },
    })
    if (error) return []
    const rawData = data.data || {}
    const resultMap = Array.isArray(rawData)
      ? rawData.reduce((map: Record<string, InstallableCheckResult>, item: any) => {
        if (item?.key) map[item.key] = item.result || { ok: Boolean(item.ok) }
        return map
      }, {})
      : rawData
    return items.flatMap((item) => {
      const key = `${item.owner}/${item.repo}`
      const raw = resultMap[key]
      const result: InstallableCheckResult =
        typeof raw === 'boolean' ? { ok: raw } : (raw || { ok: false })
      if (!result.ok) return []
      return [{
        ...item,
        has_installable_assets: true,
        latest_version: result.latest_version ?? item.latest_version,
        latest_release_date: result.latest_release_date ?? item.latest_release_date,
        platforms: result.platforms?.length ? result.platforms : item.platforms,
        total_downloads: result.total_downloads ?? item.total_downloads,
      }]
    })
  } catch {
    return []
  }
}

export async function fetchRepoDetail(owner: string, repo: string): Promise<AppItem> {
  const { data, error } = await supabase.functions.invoke('github-proxy', {
    body: {
      action: 'repo',
      params: { owner, repo },
      token: cachedToken,
    },
  })
  if (error) {
    const msg = await extractErrorMessage(error)
    throw new Error(msg)
  }
  return mapRepoToApp(data.data)
}

export async function fetchReleases(owner: string, repo: string, page = 1): Promise<GitHubRelease[]> {
  const { data, error } = await supabase.functions.invoke('github-proxy', {
    body: {
      action: 'releases',
      params: { owner, repo, page },
      token: cachedToken,
    },
  })
  if (error) {
    const msg = await extractErrorMessage(error)
    throw new Error(msg)
  }
  return (data.data || []).map((r: any) => ({
    id: r.id,
    tag_name: r.tag_name,
    name: r.name || r.tag_name,
    body: r.body,
    published_at: r.published_at,
    html_url: r.html_url,
    assets: (r.assets || []).map((a: any) => ({
      name: a.name,
      size: a.size,
      download_count: a.download_count || 0,
      browser_download_url: a.browser_download_url,
    })),
  }))
}

export async function fetchReadme(owner: string, repo: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('github-proxy', {
    body: {
      action: 'readme',
      params: { owner, repo },
      token: cachedToken,
    },
  })
  if (error) {
    const msg = await extractErrorMessage(error)
    throw new Error(msg)
  }
  // GitHub API 返回的 base64 中含 `\n`，必须先清除再 atob
  const raw = (data.data?.content || '').replace(/\s/g, '')
  if (!raw) return ''
  try {
    // 优先使用 TextDecoder 正确处理多字节 UTF-8 字符（中文、emoji 等）
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    try {
      // 降级方案：旧浏览器 / 纯 ASCII README
      return decodeURIComponent(escape(atob(raw)))
    } catch {
      return ''
    }
  }
}

export async function fetchContributors(owner: string, repo: string): Promise<Array<{ login: string; avatar_url: string; html_url: string }>> {
  const { data, error } = await supabase.functions.invoke('github-proxy', {
    body: {
      action: 'contributors',
      params: { owner, repo },
      token: cachedToken,
    },
  })
  if (error) {
    const msg = await extractErrorMessage(error)
    throw new Error(msg)
  }
  return (data.data || []).map((c: any) => ({
    login: c.login,
    avatar_url: c.avatar_url,
    html_url: c.html_url,
  }))
}

export async function fetchRateLimit(): Promise<{ remaining: number; limit: number; reset: number }> {
  const { data, error } = await supabase.functions.invoke('github-proxy', {
    body: {
      action: 'rate_limit',
      token: cachedToken,
    },
  })
  if (error) {
    const msg = await extractErrorMessage(error)
    throw new Error(msg)
  }
  const core = data.data?.resources?.core || data.data?.rate || { remaining: 0, limit: 60, reset: 0 }
  return {
    remaining: core.remaining ?? 0,
    limit: core.limit ?? 60,
    reset: core.reset ?? 0,
  }
}

function mapRepoToApp(item: any): AppItem {
  const platforms = detectPlatforms(item.topics || [])
  return {
    id: item.id,
    full_name: item.full_name,
    name: item.name,
    description: item.description,
    owner: item.owner?.login || '',
    repo: item.name,
    avatar_url: item.owner?.avatar_url || '',
    stars: item.stargazers_count || 0,
    forks: item.forks_count || 0,
    language: item.language,
    topics: item.topics || [],
    platforms,
    latest_version: null,
    latest_release_date: null,
    html_url: item.html_url,
    updated_at: item.updated_at || item.pushed_at,
    license: item.license?.name || item.license?.spdx_id || null,
    archived: item.archived ?? false,
    open_issues_count: item.open_issues_count ?? 0,
    total_downloads: 0,
    has_installable_assets: false,
  }
}

function normalizeStoreQuery(q: string): string {
  const base = q.trim()
  const safeguards = ['archived:false', 'fork:false']
  return safeguards.reduce((query, token) => (
    query.includes(token) ? query : `${query} ${token}`
  ), base || 'app')
}

function detectPlatforms(topics: string[]): string[] {
  const map: Record<string, string> = {
    'android-app': 'Android',
    'android': 'Android',
    'ios-app': 'iOS',
    'ios': 'iOS',
    'macos': 'macOS',
    'macos-app': 'macOS',
    'windows': 'Windows',
    'windows-app': 'Windows',
    'linux': 'Linux',
    'linux-app': 'Linux',
    'electron': 'Windows',
    'cross-platform': 'Android',
  }
  const platforms = new Set<string>()
  for (const topic of topics) {
    const lower = topic.toLowerCase()
    if (map[lower]) platforms.add(map[lower])
  }
  return Array.from(platforms)
}

export function getPlatformFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.apk')) return 'Android'
  if (lower.endsWith('.ipa')) return 'iOS'
  if (lower.endsWith('.dmg') || lower.endsWith('.pkg')) return 'macOS'
  if (lower.endsWith('.exe') || lower.endsWith('.msi')) return 'Windows'
  if (lower.endsWith('.deb') || lower.endsWith('.rpm') || lower.endsWith('.appimage')
    || lower.endsWith('.flatpak') || lower.endsWith('.snap')) return 'Linux'
  return null
}

/** 只保留真实安装包（.apk/.ipa/.dmg/.exe/.msi/.deb/.rpm/.appimage/.flatpak/.snap/.pkg） */
export function filterInstallAssets(assets: GitHubRelease['assets']) {
  const installExts = ['.apk', '.ipa', '.dmg', '.pkg', '.exe', '.msi',
    '.deb', '.rpm', '.appimage', '.flatpak', '.snap']
  return assets.filter((a) => {
    const lower = a.name.toLowerCase()
    return installExts.some((ext) => lower.endsWith(ext))
  })
}

/** 提取签名/哈希校验文件（.asc/.sig/.sha256/.sha512/.md5） */
export function filterVerificationAssets(assets: GitHubRelease['assets']) {
  const verifyExts = ['.asc', '.sig', '.sha256', '.sha512', '.md5']
  return assets.filter((a) => {
    const lower = a.name.toLowerCase()
    return verifyExts.some((ext) => lower.endsWith(ext))
  })
}
