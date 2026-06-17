/**
 * catalog-sync Edge Function
 * 从 GitHub 搜索带安装包的开源应用，批量写入 app_catalog。
 * 调用方式：POST /functions/v1/catalog-sync
 * Body 可选：{ queries?: string[], per_query?: number, token?: string }
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const INSTALL_EXTS = ['.apk', '.ipa', '.dmg', '.pkg', '.exe', '.msi',
  '.deb', '.rpm', '.appimage', '.flatpak', '.snap']

function detectPlatform(filename: string): string[] {
  const l = filename.toLowerCase()
  const result: string[] = []
  if (l.endsWith('.apk')) result.push('Android')
  if (l.endsWith('.ipa')) result.push('iOS')
  if (l.endsWith('.dmg') || l.endsWith('.pkg')) result.push('macOS')
  if (l.endsWith('.exe') || l.endsWith('.msi')) result.push('Windows')
  if (['.deb', '.rpm', '.appimage', '.flatpak', '.snap'].some(e => l.endsWith(e))) result.push('Linux')
  return result
}

function githubHeaders(token?: string) {
  const h: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'OpenAppStore-Sync/1.0',
  }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

/** 默认搜索查询列表：覆盖主流开源应用类型 */
const DEFAULT_QUERIES = [
  // Android
  'topic:android-app stars:>1000 is:public',
  'topic:android stars:>2000 is:public',
  // iOS / Apple
  'topic:ios-app stars:>500 is:public',
  'topic:ios stars:>1000 is:public',
  // 跨平台 Electron
  'topic:electron-app stars:>1000 is:public',
  'topic:electron stars:>2000 is:public',
  // Flutter
  'topic:flutter-app stars:>500 is:public',
  // 跨平台工具
  'topic:cross-platform stars:>1000 is:public',
  // 开发工具
  'topic:developer-tools stars:>1000 is:public',
  'topic:terminal stars:>500 is:public',
  'topic:code-editor stars:>1000 is:public',
  // 媒体
  'topic:media-player stars:>500 is:public',
  'topic:music-player stars:>500 is:public',
  // 安全/隐私
  'topic:privacy stars:>500 is:public',
  'topic:password-manager stars:>500 is:public',
  // 效率工具
  'topic:productivity stars:>1000 is:public',
  'topic:note-taking stars:>1000 is:public',
  // 通讯
  'topic:messaging stars:>1000 is:public',
  'topic:chat stars:>1000 is:public',
  // 文件管理
  'topic:file-manager stars:>500 is:public',
]

async function checkHasInstallableRelease(
  owner: string, repo: string, token?: string
): Promise<{
  ok: boolean
  latest_version?: string
  latest_release_date?: string
  total_downloads: number
  platforms: string[]
} | null> {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`,
      { headers: githubHeaders(token) }
    )
    if (r.status === 403 || r.status === 429) return null  // 限速，跳过
    if (!r.ok) return { ok: false, total_downloads: 0, platforms: [] }
    const releases = await r.json() as any[]
    for (const rel of releases) {
      const assets: any[] = rel.assets || []
      const installAssets = assets.filter((a: any) =>
        INSTALL_EXTS.some(ext => a.name.toLowerCase().endsWith(ext))
      )
      if (installAssets.length === 0) continue
      const platforms = [...new Set(
        installAssets.flatMap((a: any) => detectPlatform(a.name))
      )]
      const total_downloads = installAssets.reduce(
        (s: number, a: any) => s + (a.download_count || 0), 0
      )
      return {
        ok: true,
        latest_version: rel.tag_name,
        latest_release_date: rel.published_at,
        total_downloads,
        platforms,
      }
    }
    return { ok: false, total_downloads: 0, platforms: [] }
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  try {
    const body = await req.json().catch(() => ({}))
    const queries: string[] = body.queries ?? DEFAULT_QUERIES
    const perQuery: number = Math.min(body.per_query ?? 30, 50)
    const token: string | undefined = body.token

    let totalAdded = 0
    let totalChecked = 0
    let totalSkipped = 0
    const addedRepos: string[] = []

    for (const q of queries) {
      // 搜索 GitHub
      let items: any[] = []
      try {
        const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perQuery}&page=1`
        const res = await fetch(searchUrl, { headers: githubHeaders(token) })
        if (res.status === 403 || res.status === 429) {
          console.warn(`[catalog-sync] Rate limited on query: ${q}`)
          continue
        }
        if (!res.ok) continue
        const json = await res.json()
        items = json.items || []
      } catch {
        continue
      }

      // 并发检查安装包（限5并发防限速）
      const CONCURRENCY = 5
      for (let i = 0; i < items.length; i += CONCURRENCY) {
        const batch = items.slice(i, i + CONCURRENCY)
        const results = await Promise.allSettled(
          batch.map(async (repo: any) => {
            totalChecked++
            const release = await checkHasInstallableRelease(repo.owner?.login, repo.name, token)
            if (!release || !release.ok) {
              // 写入 installable_cache 避免重复检查
              if (release !== null) {
                await supabase.from('repo_installable_cache').upsert({
                  owner: repo.owner?.login,
                  repo: repo.name,
                  has_release: false,
                  total_downloads: 0,
                  platforms: [],
                  checked_at: new Date().toISOString(),
                }, { onConflict: 'owner,repo' }).then(() => {})
              }
              totalSkipped++
              return null
            }

            const owner = repo.owner?.login
            const repoName = repo.name
            if (!owner || !repoName) return null

            // 写入 app_catalog（冲突时更新最新数据）
            const row = {
              owner,
              repo: repoName,
              full_name: repo.full_name,
              name: repo.name,
              description: repo.description ?? null,
              avatar_url: repo.owner?.avatar_url ?? null,
              stars: repo.stargazers_count ?? 0,
              forks: repo.forks_count ?? 0,
              language: repo.language ?? null,
              topics: repo.topics ?? [],
              platforms: release.platforms,
              latest_version: release.latest_version ?? null,
              latest_release_date: release.latest_release_date ?? null,
              total_downloads: release.total_downloads,
              html_url: repo.html_url ?? null,
              updated_at: repo.updated_at ?? null,
              license: repo.license?.spdx_id ?? null,
              open_issues_count: repo.open_issues_count ?? 0,
              archived: repo.archived ?? false,
              last_checked_at: new Date().toISOString(),
            }

            const { error: upsertErr } = await supabase
              .from('app_catalog')
              .upsert(row, { onConflict: 'owner,repo' })

            if (upsertErr) {
              console.error(`[catalog-sync] upsert error ${owner}/${repoName}:`, upsertErr.message)
              return null
            }

            // 同步更新 installable_cache
            await supabase.from('repo_installable_cache').upsert({
              owner,
              repo: repoName,
              has_release: true,
              latest_version: release.latest_version ?? null,
              latest_release_date: release.latest_release_date ?? null,
              total_downloads: release.total_downloads,
              platforms: release.platforms,
              checked_at: new Date().toISOString(),
            }, { onConflict: 'owner,repo' }).then(() => {})

            totalAdded++
            addedRepos.push(`${owner}/${repoName}`)
            return `${owner}/${repoName}`
          })
        )
        // 短暂延迟，避免触发 GitHub 次级限速
        await new Promise(r => setTimeout(r, 200))
      }
    }

    // 查询 app_catalog 最新总量
    const { count } = await supabase
      .from('app_catalog')
      .select('*', { count: 'exact', head: true })
      .eq('archived', false)

    return new Response(JSON.stringify({
      success: true,
      total_in_catalog: count ?? 0,
      checked: totalChecked,
      added_or_updated: totalAdded,
      skipped_no_release: totalSkipped,
      sample_added: addedRepos.slice(0, 20),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('[catalog-sync] fatal:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
