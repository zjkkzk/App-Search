import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GITHUB_API_BASE = 'https://api.github.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function githubHeaders(token?: string) {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'OpenAppStore/1.0',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, params, token } = await req.json()
    let url: string
    let method = 'GET'

    switch (action) {
      case 'search': {
        const q = params?.q || 'topic:android-app OR topic:ios-app OR topic:electron'
        const sort = params?.sort || 'stars'
        const order = params?.order || 'desc'
        const page = params?.page || 1
        const perPage = params?.per_page || 30
        url = `${GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(q)}&sort=${sort}&order=${order}&page=${page}&per_page=${perPage}`
        break
      }
      case 'repo': {
        const owner = params?.owner
        const repo = params?.repo
        if (!owner || !repo) throw new Error('Missing owner or repo')
        url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`
        break
      }
      case 'releases': {
        const owner = params?.owner
        const repo = params?.repo
        const page = params?.page || 1
        if (!owner || !repo) throw new Error('Missing owner or repo')
        url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases?page=${page}&per_page=20`
        break
      }
      case 'readme': {
        const owner = params?.owner
        const repo = params?.repo
        if (!owner || !repo) throw new Error('Missing owner or repo')
        url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/readme`
        break
      }
      case 'contributors': {
        const owner = params?.owner
        const repo = params?.repo
        if (!owner || !repo) throw new Error('Missing owner or repo')
        url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contributors?per_page=10`
        break
      }
      case 'rate_limit': {
        url = `${GITHUB_API_BASE}/rate_limit`
        break
      }
      case 'check_installable_batch': {
        // 批量检查多个仓库的最新 Release 是否含可安装包，一次 Edge Function 调用并发检测
        const repos = (params?.repos || []) as Array<{ owner: string; repo: string }>
        const INSTALL_EXTS = ['.apk', '.ipa', '.dmg', '.exe', '.msi', '.deb', '.rpm', '.appimage', '.flatpak', '.snap']
        const checks = await Promise.all(
          repos.map(async ({ owner, repo }) => {
            try {
              const r = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`, {
                headers: githubHeaders(token),
              })
              if (!r.ok) return { key: `${owner}/${repo}`, ok: false }
              const rel = await r.json()
              const hasInstallable = (rel.assets || []).some((a: any) =>
                INSTALL_EXTS.some((ext) => a.name.toLowerCase().endsWith(ext))
              )
              return { key: `${owner}/${repo}`, ok: hasInstallable }
            } catch {
              return { key: `${owner}/${repo}`, ok: false }
            }
          })
        )
        const map: Record<string, boolean> = {}
        checks.forEach(({ key, ok }) => { map[key] = ok })
        return new Response(JSON.stringify({ data: map }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      default:
        throw new Error(`Unknown action: ${action}`)
    }

    const response = await fetch(url, {
      method,
      headers: githubHeaders(token),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(
        JSON.stringify({ error: `GitHub API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()

    return new Response(JSON.stringify({ data, headers: Object.fromEntries(response.headers.entries()) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
