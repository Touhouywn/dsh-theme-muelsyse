/**
 * Muelsyse · 生态科 — DeepSeek Harness theme plugin (host half).
 *
 * Responsibilities, and nothing else:
 *   1. serve the theme's own assets (`theme.css`, the opening film, the looped
 *      workshop background, the BGM loop, the poster and artwork) from
 *      `/theme-muelsyse/*`, so they can be edited in place without rebuilding;
 *   2. contribute the index-injection rows — stylesheet link, the dark-palette
 *      hold and a tiny page self-check;
 *   3. answer `/theme-muelsyse/status`, which is how the theme proves it is
 *      live without looking at the window.
 *
 * There is no model-facing surface: no tool, no prompt section, no request.
 */
import { stat, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable Cordis plugin name. */
export const name = 'theme-muelsyse'

/** The asset route needs the host web server; the plugin stays pending without one. */
export const inject = ['webServer']

/** Route prefix owned by this plugin (no trailing slash). */
const ROUTE = '/theme-muelsyse'

const PLUGIN_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Public path → file on disk. An explicit allow-list, so no request can walk out of the package. */
const FILES = new Map([
  ['theme.css', { file: join(PLUGIN_ROOT, 'theme', 'theme.css'), type: 'text/css; charset=utf-8' }],
  ['background.webp', { file: join(PLUGIN_ROOT, 'assets', 'background.webp'), type: 'image/webp' }],
  ['openings/A.mp4', { file: join(PLUGIN_ROOT, 'assets', 'openings', 'A.mp4'), type: 'video/mp4' }],
  ['openings/score-A.m4a', { file: join(PLUGIN_ROOT, 'assets', 'openings', 'score-A.m4a'), type: 'audio/mp4' }],
  ['openings/B.mp4', { file: join(PLUGIN_ROOT, 'assets', 'openings', 'B.mp4'), type: 'video/mp4' }],
  ['openings/score-B.m4a', { file: join(PLUGIN_ROOT, 'assets', 'openings', 'score-B.m4a'), type: 'audio/mp4' }],
  ['openings/C.mp4', { file: join(PLUGIN_ROOT, 'assets', 'openings', 'C.mp4'), type: 'video/mp4' }],
  ['openings/score-C.m4a', { file: join(PLUGIN_ROOT, 'assets', 'openings', 'score-C.m4a'), type: 'audio/mp4' }],
  ['openings/D.mp4', { file: join(PLUGIN_ROOT, 'assets', 'openings', 'D.mp4'), type: 'video/mp4' }],
  ['openings/score-D.m4a', { file: join(PLUGIN_ROOT, 'assets', 'openings', 'score-D.m4a'), type: 'audio/mp4' }],
  ['loop-2k60fps.mp4', { file: join(PLUGIN_ROOT, 'assets', 'loop-2k60fps.mp4'), type: 'video/mp4' }],
  ['bgm/01-eco-pv.m4a', { file: join(PLUGIN_ROOT, 'assets', 'bgm', '01-eco-pv.m4a'), type: 'audio/mp4' }],
  ['bgm/02-eco-showcase.m4a', { file: join(PLUGIN_ROOT, 'assets', 'bgm', '02-eco-showcase.m4a'), type: 'audio/mp4' }],
  ['bgm/03-morning-dew.m4a', { file: join(PLUGIN_ROOT, 'assets', 'bgm', '03-morning-dew.m4a'), type: 'audio/mp4' }],
  ['poster.webp', { file: join(PLUGIN_ROOT, 'assets', 'poster.webp'), type: 'image/webp' }],
  ['icon.png', { file: join(PLUGIN_ROOT, 'assets', 'icon.png'), type: 'image/png' }],
])

/** Requests served per asset since this host process started. */
const HITS = { 'theme.css': 0, 'background.webp': 0 }
let lastReport = null
let reportCount = 0

/** Page-side probe: report what the theme actually sees, for `/status`. */
const PAGE_REPORT_SCRIPT = `(() => {
  const report = () => {
    const frame = document.querySelector('#root > div:first-child')
    const facts = new URLSearchParams({
      dark: String(document.body.hasAttribute('data-ds-dark-theme')),
      pref: String(document.documentElement.dataset.dsThemeSource || '-'),
      frame: String(frame !== null),
      center: String(document.querySelector('[class*="centerCol"]') !== null),
      sidebar: String(document.querySelector('[class*="sidebarCol"]') !== null),
      applied: String(getComputedStyle(document.body).getPropertyValue('--muelsyse-theme').trim() || '-'),
      base: String(getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim()),
      opening: String(document.getElementById('muelsyse-opening') !== null),
      loop: String(document.getElementById('muelsyse-loop') !== null),
      link: String(document.querySelector('link[href*="/theme-muelsyse/"]') !== null),
      inner: window.innerWidth + 'x' + window.innerHeight
    })
    fetch('/theme-muelsyse/report?' + facts.toString(), { cache: 'no-store' }).catch(() => {})
  }
  setTimeout(report, 1400)
})()`

/** Palette hold plus the probe: the body script the index row carries. */
const PAGE_SCRIPT = `(() => {
  const attribute = 'data-ds-dark-theme'
  const hold = () => { if (!document.body.hasAttribute(attribute)) document.body.setAttribute(attribute, '') }
  hold()
  new MutationObserver(hold).observe(document.body, { attributes: true, attributeFilter: [attribute] })
  document.documentElement.style.colorScheme = 'dark'
})()
${PAGE_REPORT_SCRIPT}`

function serveReport(req, res) {
  const params = new URL(req.url ?? '/', 'http://example.invalid').searchParams
  lastReport = Object.fromEntries(params.entries())
  reportCount += 1
  res.writeHead(204, { 'cache-control': 'no-store' })
  res.end()
}

function serveStatus(res) {
  const body = JSON.stringify({
    theme: 'muelsyse-ecologia',
    route: ROUTE,
    hits: { ...HITS },
    reportCount,
    lastReport,
  })
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

async function sendFile(file, type, req, res) {
  let info
  try {
    info = await stat(file)
  } catch {
    res.writeHead(404, { 'cache-control': 'no-store' })
    res.end()
    return
  }
  const etag = `"${Math.trunc(info.mtimeMs).toString(36)}-${info.size.toString(36)}"`
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': 'no-cache' })
    res.end()
    return
  }
  const body = await readFile(file)
  const size = body.byteLength

  const range = req.headers.range
  if (typeof range === 'string' && range.startsWith('bytes=')) {
    const [rawStart, rawEnd] = range.slice(6).split('-')
    let start = rawStart === '' ? size - Number(rawEnd) : Number(rawStart)
    let end = rawStart === '' || rawEnd === '' || rawEnd === undefined ? size - 1 : Number(rawEnd)
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end && start < size) {
      end = Math.min(end, size - 1)
      const chunk = body.subarray(start, end + 1)
      res.writeHead(206, {
        'content-type': type,
        'content-length': String(chunk.byteLength),
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache',
        etag,
      })
      res.end(req.method === 'HEAD' ? undefined : chunk)
      return
    }
    res.writeHead(416, { 'content-range': `bytes */${size}`, 'cache-control': 'no-cache' })
    res.end()
    return
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': String(size),
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
    etag,
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

async function serveAsset(pathname, req, res) {
  const key = pathname.slice(ROUTE.length + 1)
  if (key === 'status') {
    serveStatus(res)
    return
  }
  if (key === 'report') {
    serveReport(req, res)
    return
  }
  const entry = FILES.get(key)
  if (entry === undefined) {
    res.writeHead(404, { 'cache-control': 'no-store' })
    res.end()
    return
  }
  if (HITS[key] !== undefined) HITS[key] += 1
  await sendFile(entry.file, entry.type, req, res)
}

export function apply(ctx, config = {}) {
  const forceDark = config?.forceDark !== false

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' })
            res.end()
            return
          }
          const { pathname } = new URL(req.url ?? '/', 'http://localhost')
          try {
            await serveAsset(pathname, req, res)
          } catch (error) {
            if (process.env.MUELSYSE_DEBUG === '1') console.error(error)
            try {
              if (!res.headersSent) res.writeHead(500, { 'cache-control': 'no-store' })
              res.end()
            } catch {
              // The socket is already gone.
            }
          }
        },
      }),
    'theme-muelsyse: asset route',
  )

  ctx.on(
    'webserver/index-inject',
    (table) => {
      table.push({ kind: 'html', placement: 'head', html: `<link rel="stylesheet" href="${ROUTE}/theme.css">` })
      table.push({
        kind: 'html',
        placement: 'head',
        html: `<link rel="preload" as="image" href="${ROUTE}/background.webp">`,
      })
      if (forceDark) {
        table.push({ kind: 'script', placement: 'body', text: PAGE_SCRIPT })
      } else {
        table.push({ kind: 'script', placement: 'body', text: PAGE_REPORT_SCRIPT })
      }
    },
    { prepend: false },
  )
}
