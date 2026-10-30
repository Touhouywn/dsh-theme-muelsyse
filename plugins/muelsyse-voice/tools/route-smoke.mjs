#!/usr/bin/env node
/**
 * L1/L2 route smoke — 不拉起 DSH，直接 import index.js，用假 ctx/req/res 打 handler。
 *
 *   node tools/route-smoke.mjs
 *
 * L1: /status /catalog /clip；404 兜底。
 * L2: /speak 技术句→空计划、短句→切片、长句→切片/静默（无翻译通道，不出 tts）；
 *     /synth 503；空 text 400。
 */
// 强制一个不在 clips/ 内的 REF：验证红线 + 让 /synth 稳定走 503（不管本机引擎开没开）
process.env.MUELSYSE_TTS_REF = 'C:\Windows\notepad.exe'
import { apply } from '../index.js'

const ROUTE = '/muelsyse-voice'
let captured = null
const ctx = {
  effect: (fn) => fn(),
  webServer: {
    register: (opts) => {
      captured = opts
      return () => {}
    },
  },
}
apply(ctx, {})

if (!captured || captured.kind !== 'prefix' || captured.path !== ROUTE) {
  console.error('FAIL webServer.register not called with prefix ' + ROUTE)
  process.exit(1)
}

async function call(pathname, method = 'GET', body = null) {
  const chunks = []
  const res = {
    status: 0,
    headers: {},
    writeHead(status, headers = {}) {
      this.status = status
      this.headers = headers
    },
    end(data) {
      if (data !== undefined) chunks.push(Buffer.from(data))
    },
  }
  const listeners = {}
  const req = {
    url: ROUTE + pathname,
    method,
    on(event, fn) {
      ;(listeners[event] = listeners[event] || []).push(fn)
      return req
    },
    destroy() {},
  }
  setTimeout(() => {
    if (body !== null) for (const fn of listeners.data || []) fn(Buffer.from(JSON.stringify(body)))
    for (const fn of listeners.end || []) fn()
  }, 0)
  await captured.handler(req, res)
  return { status: res.status, headers: res.headers, body: Buffer.concat(chunks) }
}

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`)
}

const status = await call('/status')
const statusJson = JSON.parse(status.body.toString('utf8'))
check('/status 200', status.status === 200, String(status.status))
check('/status clips=37', statusJson.clips === 37, String(statusJson.clips))
check('/status catalog 2.1', Number(statusJson.catalogVersion) === 2.1, String(statusJson.catalogVersion))
check('/status tts 未配置', statusJson.tts?.configured === false, JSON.stringify(statusJson.tts))
check('/status translate 未接', statusJson.translate?.available === false, JSON.stringify(statusJson.translate))

const catalog = await call('/catalog')
const catalogJson = JSON.parse(catalog.body.toString('utf8'))
check('/catalog 37 条', catalogJson.clips?.length === 37, String(catalogJson.clips?.length))

const clip = await call('/clip/CN_001')
check('/clip/CN_001 200', clip.status === 200 && /audio\/wav/.test(clip.headers['content-type'] || ''),
  String(clip.headers['content-type']))
check('/clip/CN_001 非空', clip.body.length > 44, `${clip.body.length} bytes`)
check('未知 clip 404', (await call('/clip/CN_999')).status === 404)

const tech = await call('/speak', 'POST', { text: '把 src/index.js 里的函数改一下' })
const techJson = JSON.parse(tech.body.toString('utf8'))
check('技术句 200', tech.status === 200, String(tech.status))
check('技术句 → 空计划', techJson.segments?.length === 0, `segments=${techJson.segments?.length}`)

const short = await call('/speak', 'POST', { text: 'あたしの助けが必要かしら？' })
const shortJson = JSON.parse(short.body.toString('utf8'))
check('短句 → 切片', shortJson.segments?.[0]?.kind === 'clip', JSON.stringify(shortJson.segments?.[0]?.kind))
check('短句命中 CN_022', shortJson.segments?.[0]?.clip?.id === 'CN_022',
  String(shortJson.segments?.[0]?.clip?.id))

const long = await call('/speak', 'POST',
  { text: '大地に滴る雨にも、加湿器の霧にも。あなたがあたしを求める声は、いつもちゃんと聞こえるわ。' })
const longJson = JSON.parse(long.body.toString('utf8'))
check('长句 无翻译不出 tts', !(longJson.segments || []).some((s) => s.kind === 'tts'),
  JSON.stringify((longJson.segments || []).map((s) => s.kind)))
check('长句 有段或静默计数', (longJson.segments || []).length + longJson.stats.silent > 0,
  JSON.stringify(longJson.stats))

const zhHit = await call('/speak', 'POST', { text: '我在听哦' })
const zhHitJson = JSON.parse(zhHit.body.toString('utf8'))
check('中文短句 → 切片（cnText 三路检索）', zhHitJson.segments?.[0]?.kind === 'clip',
  JSON.stringify(zhHitJson.segments?.[0]?.kind))
check('中文短句命中 CN_021', zhHitJson.segments?.[0]?.clip?.id === 'CN_021',
  String(zhHitJson.segments?.[0]?.clip?.id))

const zh = await call('/speak', 'POST', { text: '博士，你在吗' })
const zhJson = JSON.parse(zh.body.toString('utf8'))
check('中文句 200 且不崩', zh.status === 200 && Array.isArray(zhJson.segments),
  JSON.stringify(zhJson.stats))

const synth = await call('/synth?text=こんにちは')
check('/synth 503（L3 未接）', synth.status === 503, String(synth.status))
check('空 text 400', (await call('/speak', 'POST', { text: '' })).status === 400)
check('未实现路由 404', (await call('/nope')).status === 404)

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
if (failed.length) process.exit(1)
