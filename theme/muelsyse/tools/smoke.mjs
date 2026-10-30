// Offline smoke test for the Muelsyse theme host half: no DSH required.
//
//   node tools/smoke.mjs
//
// Exercises the route table, the asset allow-list, ETag revalidation, the
// method guard, the status route and the page-report handler. Media assets
// that ship as assets (loop, openings, scores, bgm) are checked only
// when present, so the shell can be verified before the films are delivered.
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, name, inject } from '../lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))

const routes = []
const injections = new Map()
const disposers = []

const ctx = {
  effect(fn, label) {
    const dispose = fn()
    disposers.push({ label, dispose })
    return dispose
  },
  on(event, handler, options) {
    injections.set(event, { handler, options })
    return () => injections.delete(event)
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
  },
}

apply(ctx, {})

let failures = 0
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(44)} ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

console.log('name     :', name)
console.log('inject   :', inject)
console.log('routes   :', routes.map((r) => `${r.kind} ${r.path}`).join(', '))

const table = []
injections.get('webserver/index-inject').handler(table)
console.log('rows     :', table.map((r) => r.kind).join(', '))

function request(url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const res = {
      status: 0,
      headers: {},
      writeHead(status, extra = {}) {
        this.status = status
        this.headers = extra
      },
      end(body) {
        if (body) chunks.push(Buffer.from(body))
        resolve({ status: this.status, headers: this.headers, body: Buffer.concat(chunks) })
      },
      on() {},
      once() {},
      destroy() {},
    }
    Promise.resolve(routes[0].handler({ method, url, headers }, res)).catch(reject)
  })
}

const css = await request('/theme-muelsyse/theme.css')
check('GET theme.css', css.status, 200)
check('theme.css content-type', css.headers['content-type'].split(';')[0], 'text/css')
check('theme.css declares marker', css.body.toString().includes('--muelsyse-theme'), true)

const revalidated = await request('/theme-muelsyse/theme.css', 'GET', { 'if-none-match': css.headers.etag })
check('revalidate (same etag)', revalidated.status, 304)

const traversal = await request('/theme-muelsyse/../package.json')
check('path traversal', traversal.status, 404)
const missing = await request('/theme-muelsyse/nope.webp')
check('unknown asset', missing.status, 404)
const post = await request('/theme-muelsyse/theme.css', 'POST')
check('POST theme.css', post.status, 405)

for (const [key, type] of [
  ['loop.mp4', 'video/mp4'],
  ['openings/A.mp4', 'video/mp4'],
  ['openings/B.mp4', 'video/mp4'],
  ['openings/C.mp4', 'video/mp4'],
  ['openings/D.mp4', 'video/mp4'],
  ['openings/score-A.m4a', 'audio/mp4'],
  ['openings/score-B.m4a', 'audio/mp4'],
  ['openings/score-C.m4a', 'audio/mp4'],
  ['openings/score-D.m4a', 'audio/mp4'],
  ['bgm/01-eco-pv.m4a', 'audio/mp4'],
  ['bgm/02-eco-showcase.m4a', 'audio/mp4'],
  ['bgm/03-morning-dew.m4a', 'audio/mp4'],
]) {
  const fp = resolve(here, '../assets', key.split('/').join('/'))
  if (existsSync(fp)) {
    const r = await request(`/theme-muelsyse/${key}`)
    check(`GET ${key}`, r.status, 200)
    check(`${key} content-type`, r.headers['content-type'], type)
  } else {
    console.log(`skip ${key} (not delivered yet)`)
  }
}

const reported = await request('/theme-muelsyse/report?opening=false&loop=true')
check('report accepted', reported.status, 204)

const status = await request('/theme-muelsyse/status')
check('GET status', status.status, 200)
check('status theme name', JSON.parse(status.body.toString()).theme, 'muelsyse-ecologia')

for (const entry of disposers) entry.dispose()
check('routes after dispose', routes.length, 0)

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
