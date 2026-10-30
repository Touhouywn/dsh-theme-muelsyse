#!/usr/bin/env node
/**
 * /speak 长中文 -> 翻译 -> tts 段（需要 MUELSYSE_TRANSLATE_API_KEY）。
 *   node tools/speak-tts-test.mjs
 */
import { apply } from '../index.js'

let captured = null
apply({ effect: (fn) => fn(), webServer: { register: (o) => { captured = o; return () => {} } } }, {})
const ROUTE = '/muelsyse-voice'

async function call(pathname, method, body) {
  const chunks = []
  const res = {
    status: 0, headers: {},
    writeHead(s, h = {}) { this.status = s; this.headers = h },
    end(d) { if (d !== undefined) chunks.push(Buffer.from(d)) },
  }
  const listeners = { data: [], end: [] }
  const req = {
    url: ROUTE + pathname,
    method,
    on(e, fn) {
      if (listeners[e]) listeners[e].push(fn)
      return req
    },
    destroy() {},
  }
  // 等 handler 先挂上 readJson 的监听，再喂 body
  setTimeout(() => {
    if (body !== null) for (const fn of listeners.data) fn(Buffer.from(JSON.stringify(body)))
    for (const fn of listeners.end) fn()
  }, 120)
  await captured.handler(req, res)
  return { status: res.status, raw: Buffer.concat(chunks).toString('utf8') }
}

const text = '博士，今天也要好好休息，罗德岛的走廊里水汽很重。'
const r = await call('/speak', 'POST', { text })
const plan = JSON.parse(r.raw || '{}')
console.log('status', r.status, 'translate', JSON.stringify(plan.translate))
for (const s of plan.segments || []) console.log(' segment', s.type, s.ja || s.text, s.url || '')
const tts = (plan.segments || []).find((s) => s.type === 'tts')
if (!tts || !String(tts.ja || '').includes('ロドス')) {
  console.error('FAIL 长中文没有产出 tts 段')
  process.exit(1)
}
console.log('ok 长中文 -> tts')
