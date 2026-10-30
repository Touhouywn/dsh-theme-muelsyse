import { apply } from '../index.js'
let captured = null
apply({ effect: (fn) => fn(), webServer: { register: (o) => { captured = o; return () => {} } } }, {})
const ROUTE = '/muelsyse-voice'
async function call(pathname) {
  const chunks = []
  const res = {
    status: 0, headers: {},
    writeHead(s, h = {}) { this.status = s; this.headers = h },
    end(d) { if (d !== undefined) chunks.push(Buffer.from(d)) },
  }
  const listeners = {}
  const req = { url: ROUTE + pathname, method: 'GET', on(e, fn) { (listeners[e] = listeners[e] || []).push(fn); return req }, destroy() {} }
  setTimeout(() => { for (const fn of listeners.end || []) fn() }, 0)
  await captured.handler(req, res)
  return { status: res.status, headers: res.headers, body: Buffer.concat(chunks) }
}
const r1 = await call('/synth?stream=1&text=' + encodeURIComponent('おはよう。'))
console.log('stream', r1.status, r1.headers['content-type'], r1.headers['x-muelsyse-ttfb-ms'], r1.body.length)
if (r1.status !== 200) console.log('body', r1.body.toString('utf8').slice(0, 300))
await new Promise((r) => setTimeout(r, 1500))
const r2 = await call('/synth?stream=1&text=' + encodeURIComponent('おやすみ。'))
console.log('stream2', r2.status, r2.headers['content-type'], r2.headers['x-muelsyse-ttfb-ms'], r2.body.length)
if (r2.status !== 200) console.log('body2', r2.body.toString('utf8').slice(0, 300))
