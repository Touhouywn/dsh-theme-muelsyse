/**
 * Muelsyse · voice — synthesis engine adapter (host half).
 *
 * Wraps a GPT-SoVITS api_v2 server with the sandrone-fairy protocol:
 * media_type=raw + streaming_mode=3 for live PCM, wav + cache for whole
 * sentences. All knobs come from MUELSYSE_TTS_* environment variables.
 *
 * Red line: the reference audio must live inside this plugin's assets/clips/.
 * Anything else (another character's clips, arbitrary paths) leaves the engine
 * off — ttsConfigured() = false — so /speak degrades to the clip bank.
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const env = (name, fallback) => {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const CLIP_DIR = path.join(PLUGIN_ROOT, 'assets', 'clips')

const apiUrl = () => env('MUELSYSE_TTS_API', 'http://127.0.0.1:9880')
// 默认主参考 = 官方切片 CN_034；env 可覆盖，但覆盖后仍必须落在 clips/ 内。
const refAudio = () => env('MUELSYSE_TTS_REF', path.join(CLIP_DIR, 'refs', 'CN_034-48k.wav'))

let textCache = { ref: '', text: '' }
/** REF_TEXT：env 优先；否则从 catalog 取该参考切片的官方 ja_text。 */
function refText() {
  const configured = env('MUELSYSE_TTS_REF_TEXT', '')
  if (configured !== '') return configured
  const ref = refAudio()
  if (textCache.ref === ref) return textCache.text
  let text = ''
  try {
    const catalog = JSON.parse(
      readFileSync(path.join(PLUGIN_ROOT, 'assets', 'catalog.json'), 'utf8'),
    )
    const base = path.basename(ref)
    const clipName = base.replace(/-48k\.wav$/i, '.wav')
    const hit = (catalog.clips || []).find(
      (c) => path.basename(String(c.file)) === base || path.basename(String(c.file)) === clipName,
    )
    text = hit?.text || ''
  } catch {
    text = ''
  }
  textCache = { ref, text }
  return text
}
const launcher = () => env('MUELSYSE_TTS_LAUNCHER', '')
// 启动脚本：env 指定优先，否则退回插件自带的 tools/start-sovits.ps1。
// 两者都找不到 → 无法自动拉起，只能人工启动（面板会提示）。
const launcherScript = () => launcher() || path.join(PLUGIN_ROOT, 'tools', 'start-sovits.ps1')
const shell = () => env('MUELSYSE_TTS_SHELL', 'pwsh')
const speed = () => Number(env('MUELSYSE_TTS_SPEED', '1.0')) || 1.0
const ttfbMs = () => Number(env('MUELSYSE_TTS_TTFB_MS', '5000')) || 5000
const timeoutMs = () => Number(env('MUELSYSE_TTS_TIMEOUT_MS', '120000')) || 120000
const wakeMs = () => Number(env('MUELSYSE_TTS_WAKE_MS', '35000')) || 35000
const cacheRoot = () => {
  const configured = env('MUELSYSE_TTS_CACHE', '')
  if (configured && (path.isAbsolute(configured) || /^[A-Za-z]:[\\/]/.test(configured))) return configured
  return path.join(os.tmpdir(), configured || 'muelsyse-voice-cache')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Ref audio must resolve inside assets/clips/ — no cross-character fallback. */
export function refAudioInsideBank() {
  const ref = refAudio()
  if (ref === '') return false
  const resolved = path.resolve(ref)
  const prefix = CLIP_DIR.endsWith(path.sep) ? CLIP_DIR : CLIP_DIR + path.sep
  return resolved.startsWith(prefix) && existsSync(resolved)
}

/** Engine gate: no legitimate in-bank reference → adapter stays off. */
export function ttsConfigured() {
  return refAudioInsideBank()
}

let probe = { at: 0, ok: false }
let child = null
let spawnAt = 0

/** Probe only — never wakes the model process. */
export async function ttsApiStatus() {
  if (!ttsConfigured()) return false
  try {
    const response = await fetch(apiUrl() + '/openapi.json', {
      method: 'GET',
      signal: AbortSignal.timeout(1200),
    })
    probe = { at: Date.now(), ok: response.status < 500 }
  } catch {
    probe = { at: Date.now(), ok: false }
  }
  return probe.ok
}

/** 启动脚本是否真的在盘上；只查文件，不执行（面板每三秒问一次，不能有副作用）。 */
export function ttsLauncherPresent() {
  try {
    return existsSync(path.resolve(launcherScript()))
  } catch {
    return false
  }
}

/**
 * 环境快照：/status 与 /speak 共用，客户端据此显示「环境在线 / 环境缺失」。
 * serverOnline 就是 ttsApiStatus() 的结论——没有 in-bank 参考音频时它恒为
 * false，因为 refs 缺了引擎本来也跑不起来。
 */
export async function ttsEnv() {
  const serverOnline = await ttsApiStatus().catch(() => false)
  return {
    serverOnline,
    launcherPresent: ttsLauncherPresent(),
    refAudioPresent: ttsConfigured(),
    apiUrl: apiUrl(),
  }
}

/** Spawn the .ps1 launcher — env path first, else the bundled tool — once per 30s. */
function ensureServer() {
  if (child) return true
  const script = launcherScript()
  if (!script || !existsSync(script) || Date.now() - spawnAt < 30000) return false
  spawnAt = Date.now()
  try {
    const proc = spawn(shell(), ['-NoProfile', '-File', script], {
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    })
    child = proc
    proc.on('exit', () => {
      if (child === proc) child = null
    })
    if (proc.unref) proc.unref()
    return true
  } catch {
    child = null
    return false
  }
}

export async function ttsReady() {
  if (await ttsApiStatus()) return true
  const spawned = ensureServer()
  const deadline = Date.now() + (spawned ? wakeMs() : 0)
  while (Date.now() < deadline) {
    await sleep(1200)
    if (await ttsApiStatus()) return true
  }
  return false
}

function seedOf(text) {
  return (
    parseInt(
      createHash('sha1')
        .update(refText() + '\u0000' + text)
        .digest('hex')
        .slice(0, 8),
      16,
    ) % 2147483647
  )
}

function payload(text, stream) {
  return {
    text,
    text_lang: 'ja',
    ref_audio_path: refAudio().replace(/\\/g, '/'),
    prompt_text: refText(),
    prompt_lang: 'ja',
    top_k: 15,
    top_p: 0.95,
    temperature: 0.95,
    text_split_method: 'cut5',
    batch_size: 1,
    speed_factor: speed(),
    media_type: stream ? 'raw' : 'wav',
    streaming_mode: stream ? 3 : false,
    seed: seedOf(text),
    repetition_penalty: 1.35,
    fragment_interval: 0.3,
  }
}

/** RMS (dBFS) of the first wav data chunk; -Infinity for digital silence. */
function wavDb(buffer) {
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4)
    if (buffer.toString('ascii', offset, offset + 4) === 'data') {
      const bytes = Math.min(size, buffer.length - offset - 8)
      const samples = Math.floor(bytes / 2)
      if (samples === 0) return -Infinity
      let sum = 0
      for (let i = 0; i < samples; i += 1) {
        const value = buffer.readInt16LE(offset + 8 + i * 2)
        sum += value * value
      }
      if (sum === 0) return -Infinity
      return 20 * Math.log10(Math.sqrt(sum / samples) / 32768)
    }
    offset += 8 + size + (size % 2)
  }
  return -Infinity
}

/** >0.5% of samples pinned at ±32767 counts as clipping. */
function clipped(buffer) {
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4)
    if (buffer.toString('ascii', offset, offset + 4) === 'data') {
      const bytes = Math.min(size, buffer.length - offset - 8)
      const samples = Math.floor(bytes / 2)
      if (samples === 0) return false
      let pinned = 0
      for (let i = 0; i < samples; i += 1) {
        if (Math.abs(buffer.readInt16LE(offset + 8 + i * 2)) === 32767) pinned += 1
      }
      return pinned / samples > 0.005
    }
    offset += 8 + size + (size % 2)
  }
  return false
}

const gainDb = () => Number(env('MUELSYSE_TTS_GAIN_DB', '2.5'))

/** 合成侧电平：对齐切片库响度（L3.1），只动 16-bit PCM 数据段。 */
function scaleWav(buffer, db) {
  if (!db) return buffer
  const factor = Math.pow(10, db / 20)
  const copy = Buffer.from(buffer)
  let offset = 12
  while (offset + 8 <= copy.length) {
    const size = copy.readUInt32LE(offset + 4)
    if (copy.toString('ascii', offset, offset + 4) === 'data') {
      const bytes = Math.min(size, copy.length - offset - 8)
      const samples = Math.floor(bytes / 2)
      for (let i = 0; i < samples; i += 1) {
        const v = Math.round(copy.readInt16LE(offset + 8 + i * 2) * factor)
        copy.writeInt16LE(Math.max(-32768, Math.min(32767, v)), offset + 8 + i * 2)
      }
      break
    }
    offset += 8 + size + (size % 2)
  }
  return copy
}

const inflight = new Map()

function cachePath(text) {
  const key = createHash('sha256')
    .update([refAudio(), refText(), speed(), gainDb(), text].join('\u0000'))
    .digest('hex')
  return path.join(cacheRoot(), key + '.wav')
}

/** Whole-sentence wav: cached, RMS/clip-checked, one retry, no streaming. */
export async function synthWav(text) {
  const target = cachePath(text)
  if (existsSync(target)) return readFile(target)
  if (inflight.has(target)) return inflight.get(target)
  const run = synthWavRun(text, target)
  inflight.set(target, run)
  try {
    return await run
  } finally {
    inflight.delete(target)
  }
}

async function synthWavRun(text, target) {
  if (!(await ttsReady())) throw new Error('tts offline')
  let lastError = new Error('tts failed')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(apiUrl() + '/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload(text, false)),
        signal: AbortSignal.timeout(timeoutMs()),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error('tts ' + response.status + ' ' + detail.slice(0, 120))
      }
      const raw = Buffer.from(await response.arrayBuffer())
      if (raw.length < 1024) throw new Error('tts empty audio')
      const gain = attempt === 0 ? gainDb() : Math.min(gainDb(), 2.0)
      const buffer = scaleWav(raw, gain)
      const db = wavDb(buffer)
      if (db < -40) {
        throw new Error('tts silent ' + (db === -Infinity ? 'inf' : db.toFixed(1)) + 'dB')
      }
      if (clipped(buffer)) throw new Error('tts clipped at +' + gain + 'dB')
      try {
        mkdirSync(cacheRoot(), { recursive: true })
        await writeFile(target, buffer)
      } catch {
        /* cache optional */
      }
      return buffer
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

/** Live PCM stream: TTFB budget enforced, no caching, no RMS gate. */
export async function synthStreamFetch(text) {
  if (!(await ttsReady())) throw new Error('tts offline')
  const start = Date.now()
  const response = await fetch(apiUrl() + '/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload(text, true)),
    signal: AbortSignal.timeout(timeoutMs()),
  })
  const elapsedMs = Date.now() - start
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new Error('tts stream ' + response.status + ' ' + detail.slice(0, 120))
  }
  if (elapsedMs > ttfbMs()) {
    try {
      response.body.cancel()
    } catch {
      /* ignore */
    }
    throw new Error('tts slow ' + elapsedMs + 'ms')
  }
  return { response, elapsedMs }
}
