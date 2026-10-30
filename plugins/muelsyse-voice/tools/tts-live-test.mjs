#!/usr/bin/env node
/**
 * L3 实测：真引擎下合成 3 段 + 流式 TTFB + /synth 路由（假 ctx/res）。
 *
 *   MUELSYSE_TTS_REF=<plugin>\assets\clips\CN_034.wav
 *   MUELSYSE_TTS_REF_TEXT=ふぅ、少なくとも、あたしに触れられる人として、まだあなたがいるわね。
 *
 * 产物：03-tagged/tts-samples/L3-sample-*.wav、03-tagged/live-L3-latency.json
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { apply } from '../index.js'
import { synthStreamFetch, synthWav, ttsConfigured } from '../synth.js'

const V1 = process.env.MUELSYSE_V1 || 'E:\\AI-theme\\muelsyse\\.assets-src\\voice\\v1'
const OUT = path.join(V1, '03-tagged')
const SAMPLES = path.join(OUT, 'tts-samples')
const ROUTE = '/muelsyse-voice'
const TEXTS = [
  'こんにちは。',
  '博士、少し休みましょうか。',
  '大地に滴る雨にも、加湿器の霧にも。あなたがあたしを求める声は、いつもちゃんと聞こえるわ。',
]

function wavStats(buffer) {
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4)
    if (buffer.toString('ascii', offset, offset + 4) === 'data') {
      const samples = Math.floor(Math.min(size, buffer.length - offset - 8) / 2)
      if (samples === 0) return { samples: 0, rmsDb: null, seconds: 0 }
      let sum = 0
      for (let i = 0; i < samples; i += 1) {
        const v = buffer.readInt16LE(offset + 8 + i * 2) / 32768
        sum += v * v
      }
      return {
        samples,
        rmsDb: Number((20 * Math.log10(Math.sqrt(sum / samples) + 1e-9)).toFixed(2)),
        seconds: Number((samples / 32000).toFixed(2)),
      }
    }
    offset += 8 + size + (size % 2)
  }
  return { samples: 0, rmsDb: null, seconds: 0 }
}

if (!ttsConfigured()) {
  console.error('FAIL ttsConfigured=false：MUELSYSE_TTS_REF 必须在 assets/clips/ 内')
  process.exit(1)
}

await mkdir(SAMPLES, { recursive: true })
const samples = []
for (let i = 0; i < TEXTS.length; i += 1) {
  const started = Date.now()
  const wav = await synthWav(TEXTS[i])
  const file = path.join(SAMPLES, `L3-sample-${i + 1}.wav`)
  await writeFile(file, wav)
  const stats = wavStats(wav)
  samples.push({ text: TEXTS[i], file, bytes: wav.length, ms: Date.now() - started, ...stats })
  console.log(`sample ${i + 1}: ${Date.now() - started}ms  ${wav.length}B  ${stats.seconds}s  rms ${stats.rmsDb}dB`)
}

const t0 = Date.now()
const probe = await synthStreamFetch('こんにちは、博士。')
const ttfb = { ms: probe.elapsedMs, totalMs: Date.now() - t0 }
try {
  const reader = probe.response.body.getReader()
  await reader.read()
  await reader.cancel()
} catch { /* ignore */ }

let captured = null
apply({ effect: (fn) => fn(), webServer: { register: (o) => { captured = o; return () => {} } } }, {})
async function call(pathname) {
  const chunks = []
  const res = {
    status: 0,
    headers: {},
    writeHead(status, headers = {}) { this.status = status; this.headers = headers },
    write(chunk) { if (chunk !== undefined) chunks.push(Buffer.from(chunk)); return true },
    once() { return res },
    end(data) { if (data !== undefined) chunks.push(Buffer.from(data)) },
  }
  const listeners = {}
  const req = {
    url: ROUTE + pathname,
    method: 'GET',
    on(e, fn) { (listeners[e] = listeners[e] || []).push(fn); return req },
    destroy() {},
  }
  setTimeout(() => { for (const fn of listeners.end || []) fn() }, 0)
  await captured.handler(req, res)
  return { status: res.status, headers: res.headers, body: Buffer.concat(chunks) }
}

const routeChecks = []
const wavResp = await call('/synth?text=' + encodeURIComponent('おはよう。'))
routeChecks.push({ name: 'synth 200 wav', ok: wavResp.status === 200 && /audio\/wav/.test(wavResp.headers['content-type'] || ''), detail: `${wavResp.status} ${wavResp.headers['content-type']}` })
routeChecks.push({ name: 'synth wav 非空', ok: wavResp.body.length > 1024, detail: `${wavResp.body.length}B` })

const streamResp = await call('/synth?stream=1&text=' + encodeURIComponent('おはよう。'))
routeChecks.push({ name: 'synth stream 200', ok: streamResp.status === 200, detail: `${streamResp.status}` })
routeChecks.push({ name: 'synth stream L16', ok: /audio\/L16/.test(streamResp.headers['content-type'] || ''), detail: String(streamResp.headers['content-type']) })
routeChecks.push({ name: 'synth stream 带 TTFB 头', ok: Boolean(streamResp.headers['x-muelsyse-ttfb-ms']), detail: String(streamResp.headers['x-muelsyse-ttfb-ms']) })

const techResp = await call('/synth?text=' + encodeURIComponent('这段代码怎么改'))
routeChecks.push({ name: '技术句 400', ok: techResp.status === 400, detail: String(techResp.status) })
routeChecks.forEach((c) => console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}  ${c.detail}`))

const report = {
  at: new Date().toISOString(),
  api: process.env.MUELSYSE_TTS_API || 'http://127.0.0.1:9880',
  ref: process.env.MUELSYSE_TTS_REF,
  speed: Number(process.env.MUELSYSE_TTS_SPEED || 0.9),
  samples,
  ttfb,
  routeChecks,
  gate: { ttfbMs: 5000, ttfbOk: ttfb.ms <= 5000 },
}
await writeFile(path.join(OUT, 'live-L3-latency.json'), JSON.stringify(report, null, 1), 'utf8')
console.log(`ttfb ${ttfb.ms}ms  gate ${ttfb.ms <= 5000 ? 'ok' : 'FAIL'}`)
if (routeChecks.some((c) => !c.ok)) process.exit(1)
