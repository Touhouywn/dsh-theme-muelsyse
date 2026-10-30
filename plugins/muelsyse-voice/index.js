/**
 * Muelsyse · voice — host half.
 *
 * L1: read-only routes (status / catalog / clip / intents / intent probe).
 * L2: semantic plan — the default. One reply sentence → Chinese keyword
 *     classifier → intra-intent Dice retrieval → {type:'clip'} segment.
 *     Zero token, zero network, no SoVITS: the degrade ladder is
 *     match → default → filler → silent, and /status env is not consulted.
 *     The legacy translate → synth pipeline survives only as an explicit
 *     opt-in: POST /speak {synth:true}. Default is clips-only.
 * L4: a runtime switch. `enabled` starts from config.enabled (default true)
 *     and is owned by POST /enabled afterwards; /status stays readable either
 *     way, so the console can show 在线 / 关闭 instead of timing out.
 *
 * Intent data lives in assets/intents.json and is read once at boot: adding a
 * clip to an intent needs no code change (see tools/annotate-clips.mjs).
 *
 * No cross-character fallback: every clip here belongs to Muelsyse.
 */
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { channelStatus, translateToJa } from './translate.js'
import { synthStreamFetch, synthWav, ttsConfigured, ttsEnv } from './synth.js'
import {
  buildSemanticPlan,
  classifyIntent,
  clipsFor,
  jaDice,
  normalizeJa,
  publicClip as toPublicClip,
  splitSentences,
  technical,
} from './semantic.js'

export { jaDice, normalizeJa }

export const name = 'muelsyse-voice'

export const inject = ['webServer']

const ROUTE = '/muelsyse-voice'
const CATALOG_URL = new URL('./assets/catalog.json', import.meta.url)
const TEMPLATES_URL = new URL('./assets/templates.json', import.meta.url)
const THINKING_URL = new URL('./assets/thinking.json', import.meta.url)
const INTENTS_URL = new URL('./assets/intents.json', import.meta.url)
const ASSET_DIR = new URL('./assets/', import.meta.url)

const DEFAULT_MODE = 'semantic'
const DEFAULT_ENABLED = true
const DEFAULT_THRESHOLD_SHORT = 0.45
const DEFAULT_THRESHOLD_LONG = 0.42
const DEFAULT_MIN_SCORE = 0.18
// 一次回复一条切片：语义计划默认只排一段（按句序找到的第一处命中），
// 客户端也只播一段。把 config.maxClips 调大才回到多段计划。
const DEFAULT_MAX_CLIPS = 1
const SHORT_MAX_CHARS = 16

let bankPromise = null

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > limit) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

async function loadBank() {
  if (bankPromise) return bankPromise
  bankPromise = (async () => {
    const catalog = JSON.parse(await readFile(CATALOG_URL, 'utf8'))
    const clips = Array.isArray(catalog.clips) ? catalog.clips : []
    const byId = new Map()
    for (const clip of clips) {
      if (clip && typeof clip.id === 'string' && typeof clip.file === 'string') byId.set(clip.id, clip)
    }
    let templates = {}
    try {
      const data = JSON.parse(await readFile(TEMPLATES_URL, 'utf8'))
      if (Array.isArray(data?.templates)) {
        for (const t of data.templates) {
          if (t && typeof t.trigger === 'string' && Array.isArray(t.ids)) templates[t.trigger] = t.ids
        }
      }
    } catch {
      templates = {}
    }
    let thinking = { version: 1, phases: { start: [], mid: [], end: [] }, sounds: {} }
    try {
      const data = JSON.parse(await readFile(THINKING_URL, 'utf8'))
      if (data && typeof data.phases === 'object') thinking = data
    } catch {
      thinking = { version: 1, phases: { start: [], mid: [], end: [] }, sounds: {} }
    }
    // 意图体系是语义计划的全部配置：缺失时降级为「只做字面回声的切片计划」，
    // 绝不回退到翻译/合成，这样即使部署漏了 intents.json 也不会悄悄烧 token。
    let intents = null
    try {
      const data = JSON.parse(await readFile(INTENTS_URL, 'utf8'))
      if (data && data.intents && typeof data.intents === 'object') intents = data
    } catch {
      intents = null
    }
    return { catalog, clips, byId, templates, thinking, intents }
  })()
  return bankPromise
}

/** 旧检索：日文 2-gram Dice，三路取最高（仅 synth:true 的老链路使用）。 */
function pickRetrieval(bank, sentence, threshold) {
  const query = normalizeJa(sentence)
  if (query.length === 0) return { clip: null, score: 0 }
  let best = null
  let bestScore = 0
  for (const clip of bank.clips) {
    for (const target of [clip.asrText, clip.text, clip.cnText]) {
      const score = jaDice(query, target)
      if (score > bestScore) {
        bestScore = score
        best = clip
      }
    }
  }
  if (best === null || bestScore < threshold) return { clip: null, score: bestScore }
  return { clip: toPublicClip(best), score: Number(bestScore.toFixed(3)) }
}

/**
 * 老链路（只在 body.synth === true 时走）：技术句静默；短句检索切片；
 * 长句先翻译再合成，通道不可用或翻译失败 → 检索兜底 → 静默并计 missing。
 * 降级梯：tts → clip → silent。
 */
async function buildLegacyPlan(bank, text, limits, context = '', env = null) {
  const sentences = splitSentences(text)
  const segments = []
  const stats = { sentences: sentences.length, clip: 0, silent: 0, tts: 0, missing: 0 }
  // 环境在线才排合成段：服务不在时排出来的 /synth 只会 503，不如现在就走
  // 切片检索（命中就播，没命中就静默）。降级梯仍是 tts → clip → silent。
  const live = env !== null && env.serverOnline === true && env.refAudioPresent === true
  // 长中文句先并行翻译，别让每句串行等一遍 API
  const needTranslate = [...new Set(sentences.filter((sentence) => {
    if (technical(sentence)) return false
    if ([...normalizeJa(sentence)].length <= SHORT_MAX_CHARS) return false
    return !looksJapanese(sentence)
  }))]
  const translated = new Map()
  if (live && channelStatus().available && needTranslate.length > 0) {
    // 整段一次译（延迟最低），再按句号对齐；首句立刻起合成，客户端 /synth 会等同一发
    const jaAll = await translateToJa(needTranslate.join('。'), context)
    const pieces = jaAll
      ? jaAll.split(/(?<=[。！？!?])/).map((item) => item.trim()).filter(Boolean)
      : []
    if (pieces.length === needTranslate.length) {
      needTranslate.forEach((sentence, index) => translated.set(sentence, pieces[index]))
    } else {
      const results = await Promise.all(needTranslate.map((sentence) => translateToJa(sentence)))
      needTranslate.forEach((sentence, index) => translated.set(sentence, results[index]))
    }
    if (translated.get(needTranslate[0])) {
      synthWav(translated.get(needTranslate[0])).catch(() => {})
    }
  }
  for (const sentence of sentences) {
    if (technical(sentence)) {
      stats.silent += 1
      continue
    }
    const chars = [...normalizeJa(sentence)].length
    if (chars === 0) {
      stats.silent += 1
      continue
    }
    const short = chars <= SHORT_MAX_CHARS
    const threshold = short ? limits.short : limits.long
    const hit = pickRetrieval(bank, sentence, threshold)
    if (hit.clip) {
      segments.push({ type: 'clip', kind: 'clip', text: sentence, clip: hit.clip,
                       id: hit.clip.id, url: hit.clip.url,
                       duration: hit.clip.duration, score: hit.score })
      stats.clip += 1
      continue
    }
    if (!short) {
      // 已经是日文 → 不翻；中文长句 → 翻译通道；环境离线 → 不排合成段
      const jaText = !live
        ? null
        : looksJapanese(sentence)
          ? sentence
          : (translated.get(sentence) || null)
      if (jaText) {
        segments.push({ type: 'tts', kind: 'tts', text: sentence, ja: jaText,
                         url: `${ROUTE}/synth?stream=1&text=${encodeURIComponent(jaText)}` })
        stats.tts += 1
        continue
      }
    }
    stats.silent += 1
    stats.missing += 1
  }
  return { version: 1, mode: 'hybrid', segments, stats, translate: channelStatus(), env }
}

function looksJapanese(text) {
  return /[぀-ヿ]/.test(String(text || ''))
}

/** 从一次环境快照推出旧的 tts 字段，探测只发生一次。 */
function ttsStatus(env) {
  if (!env.refAudioPresent) return { configured: false, api: 'unconfigured' }
  return { configured: true, api: env.serverOnline ? 'ok' : 'offline' }
}

function resolveThinking(bank) {
  const phases = bank.thinking?.phases || {}
  const sounds = bank.thinking?.sounds || {}
  const map = (names) => (Array.isArray(names) ? names : []).map((name) => {
    const sound = sounds[name]
    if (!sound) return null
    return {
      id: name,
      url: `${ROUTE}/thinking/${encodeURIComponent(name)}`,
      text: '',
      duration: Number(sound.duration) || 0,
    }
  }).filter((item) => item !== null)
  return {
    version: Number(bank.thinking?.version) || 1,
    phases: { start: map(phases.start), mid: map(phases.mid), end: map(phases.end) },
  }
}

// 预热名单：出现频率最高的意图。客户端会在空闲时把它们的默认切片解码进
// AudioBuffer，命中这些意图时开口零等待。
const HOT_INTENTS = ['greeting', 'farewell', 'thanks', 'apology', 'affirm', 'confirm', 'filler', 'praise']

/**
 * /warm 的载荷：每个意图的触发词（客户端拿去做本地预判），以及高频意图的
 * 默认切片 url（客户端拿去提前解码）。**不参与选片**——播哪一条仍由 /speak 的
 * 语义计划决定，这里只是让「已经决定要播」到「真的出声」之间不再等解码。
 */
function buildWarm(bank) {
  const defs = bank.intents?.intents || {}
  const intents = {}
  for (const [name, def] of Object.entries(defs)) {
    const keywords = Array.isArray(def?.keywords) ? def.keywords : []
    const urls = []
    if (HOT_INTENTS.includes(name)) {
      const ids = []
      if (typeof def?.default === 'string' && def.default !== '') ids.push(def.default)
      if (Array.isArray(def?.clipIds)) {
        for (const id of def.clipIds) {
          if (ids.length >= 2) break
          if (!ids.includes(id)) ids.push(id)
        }
      }
      for (const id of ids) {
        const clip = bank.byId.get(id)
        if (clip) urls.push(toPublicClip(clip).url)
      }
    }
    intents[name] = {
      label: def?.label || name,
      priority: Number.isFinite(Number(def?.priority)) ? Number(def.priority) : 0,
      keywords,
      clips: urls,
    }
  }
  return {
    version: Number(bank.intents?.version) || 0,
    updated: bank.intents?.updated || '',
    settings: bank.intents?.settings || {},
    hot: HOT_INTENTS,
    intents,
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

export function apply(ctx, config = {}) {
  const mode = typeof config?.mode === 'string' ? config.mode : DEFAULT_MODE
  const thresholdShort = Number.isFinite(Number(config?.thresholdShort))
    ? Number(config.thresholdShort) : DEFAULT_THRESHOLD_SHORT
  const thresholdLong = Number.isFinite(Number(config?.thresholdLong))
    ? Number(config.thresholdLong) : DEFAULT_THRESHOLD_LONG
  const configMinScore = Number.isFinite(Number(config?.minScore))
    ? Number(config.minScore) : null
  const maxClips = Number.isFinite(Number(config?.maxClips))
    ? Math.max(1, Math.min(4, Number(config.maxClips))) : DEFAULT_MAX_CLIPS
  const limits = { short: thresholdShort, long: thresholdLong }
  // Runtime switch: config is only the boot value. A missing key reads as
  // on, so an older config keeps speaking after an upgrade.
  let enabled = typeof config.enabled === 'boolean' ? config.enabled : DEFAULT_ENABLED

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const bank = await loadBank()
      const intentCount = bank.intents ? Object.keys(bank.intents.intents || {}).length : 0
      const minScore = configMinScore !== null
        ? configMinScore
        : Number.isFinite(Number(bank.intents?.settings?.minScore))
          ? Number(bank.intents.settings.minScore)
          : DEFAULT_MIN_SCORE

      if (url.pathname === `${ROUTE}/status` && req.method === 'GET') {
        // 一次探测同时喂给 env 与 tts，别让面板每三秒扫两遍 127.0.0.1。
        // 注意：这只是面板探活，不是 /speak 的前置条件。
        const env = await ttsEnv()
        sendJson(res, 200, {
          plugin: 'muelsyse-voice',
          enabled,
          mode,
          plan: 'semantic',
          clips: bank.clips.length,
          thresholdShort,
          thresholdLong,
          maxClips,
          shortMaxChars: SHORT_MAX_CHARS,
          catalogVersion: Number(bank.catalog?.version) || 0,
          source: bank.catalog?.source || '',
          semantic: {
            intents: intentCount,
            minScore,
            maxSegments: maxClips,
            intentsLoaded: bank.intents !== null,
          },
          translate: channelStatus(),
          tts: ttsStatus(env),
          env,
        })
        return
      }

      // Idempotent: the caller states the wanted value, so a retried or
      // prefetched POST cannot flip the switch twice.
      if (url.pathname === `${ROUTE}/enabled`) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed', allow: 'POST' })
          return
        }
        const body = await readJson(req)
        if (typeof body?.enabled !== 'boolean') {
          sendJson(res, 400, { error: 'enabled must be a boolean' })
          return
        }
        enabled = body.enabled
        sendJson(res, 200, { plugin: 'muelsyse-voice', enabled, mode })
        return
      }

      if (url.pathname === `${ROUTE}/catalog` && req.method === 'GET') {
        sendJson(res, 200, { version: Number(bank.catalog?.version) || 0,
                             clips: bank.clips.map(toPublicClip) })
        return
      }

      // 意图体系只读接口：控制台/调参时能看见「哪个意图归了哪些切片」。
      if (url.pathname === `${ROUTE}/intents` && req.method === 'GET') {
        if (bank.intents === null) {
          sendJson(res, 404, { error: 'intents missing', file: 'assets/intents.json' })
          return
        }
        const resolved = {}
        for (const [intentName, def] of Object.entries(bank.intents.intents || {})) {
          resolved[intentName] = {
            label: def?.label || intentName,
            group: def?.group || '',
            priority: def?.priority,
            keywords: Array.isArray(def?.keywords) ? def.keywords : [],
            default: def?.default ?? null,
            fallback: def?.fallback ?? null,
            clips: clipsFor(bank, bank.intents, intentName).map(toPublicClip),
          }
        }
        sendJson(res, 200, {
          version: Number(bank.intents.version) || 0,
          updated: bank.intents.updated || '',
          groups: bank.intents.groups || {},
          settings: bank.intents.settings || {},
          intents: resolved,
        })
        return
      }

      // 预热接口：高频意图的触发词 + 默认切片。只缩短「决定要播 → 真的出声」的空档，
      // 选片仍然只走 /speak。
      if (url.pathname === `${ROUTE}/warm` && req.method === 'GET') {
        if (bank.intents === null) {
          sendJson(res, 404, { error: 'intents missing', file: 'assets/intents.json' })
          return
        }
        sendJson(res, 200, buildWarm(bank))
        return
      }

      // 分类器探针：给一句话，看它落到哪个意图、命中了哪些词。零网络。
      if (url.pathname === `${ROUTE}/intent` && req.method === 'GET') {
        const text = String(url.searchParams.get('text') || '')
        sendJson(res, 200, { text, classification: classifyIntent(text, bank.intents) })
        return
      }

      if (url.pathname === `${ROUTE}/thinking` && req.method === 'GET') {
        sendJson(res, 200, resolveThinking(bank))
        return
      }

      if (url.pathname.startsWith(`${ROUTE}/thinking/`) && req.method === 'GET') {
        const name = decodeURIComponent(url.pathname.slice(`${ROUTE}/thinking/`.length))
        const sound = bank.thinking?.sounds?.[name]
        if (!sound) {
          sendJson(res, 404, { error: 'unknown thinking sound' })
          return
        }
        const file = fileURLToPath(new URL(sound.file, ASSET_DIR))
        try {
          const data = await readFile(file)
          res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(data.length),
                               'cache-control': 'public, max-age=31536000, immutable' })
          res.end(data)
        } catch {
          sendJson(res, 404, { error: 'thinking sound missing' })
        }
        return
      }

      if (url.pathname.startsWith(`${ROUTE}/clip/`) && req.method === 'GET') {
        const id = decodeURIComponent(url.pathname.slice(`${ROUTE}/clip/`.length))
        const clip = bank.byId.get(id)
        if (!clip) {
          sendJson(res, 404, { error: 'unknown clip' })
          return
        }
        const path = fileURLToPath(new URL(clip.file, ASSET_DIR))
        try {
          const info = await stat(path)
          if (!info.isFile()) throw new Error('not a file')
          const data = await readFile(path)
          res.writeHead(200, {
            'content-type': 'audio/ogg',
            'content-length': String(data.length),
            'cache-control': 'public, max-age=31536000, immutable',
          })
          res.end(data)
        } catch {
          sendJson(res, 404, { error: 'clip missing' })
        }
        return
      }

      if (url.pathname === `${ROUTE}/speak` && req.method === 'POST') {
        if (!enabled) {
          // A silent plan, not an error blob: a client that keeps talking
          // gets nothing to play, and the console still reads /status.
          sendJson(res, 503, {
            enabled: false, code: 'voice-disabled', mode: 'semantic', segments: [],
            stats: { sentences: 0, segments: 0, silent: 0 },
            translate: { used: false },
            synth: { used: false },
          })
          return
        }
        const body = await readJson(req)
        const text = String(body?.text || '')
        if (text.trim() === '') {
          sendJson(res, 400, { error: 'empty text' })
          return
        }
        // 默认：本地语义检索，不探端口、不翻译、不合成。
        if (body?.synth !== true) {
          // body.seen = 客户端本回复已经播过的 clip id。首句和余下两路 /speak
          // 各自建计划，没有这份记忆就会各挑一次同一条切片（重复播放）。
          const seen = Array.isArray(body?.seen)
            ? body.seen.filter((id) => typeof id === 'string' && id !== '').slice(0, 32)
            : []
          sendJson(res, 200, buildSemanticPlan(bank, text, bank.intents, {
            minScore,
            maxSegments: maxClips,
            intent: typeof body?.intent === 'string' ? body.intent : null,
            used: seen,
            fillerOnMiss: body?.fillerOnMiss === true,
          }))
          return
        }
        // 显式 opt-in：老链路，才允许探测 SoVITS / 调翻译 API。
        const env = await ttsEnv()
        const context = String(body?.context || '').slice(0, 300)
        sendJson(res, 200, await buildLegacyPlan(bank, text, limits, context, env))
        return
      }

      if (url.pathname === `${ROUTE}/synth` && req.method === 'GET') {
        if (!enabled) {
          sendJson(res, 503, { error: 'voice disabled', code: 'voice-disabled',
                               enabled: false, fallback: 'silent' })
          return
        }
        const text = String(url.searchParams.get('text') || '').slice(0, 120).trim()
        if (text === '') {
          sendJson(res, 400, { error: 'empty text' })
          return
        }
        if (technical(text)) {
          sendJson(res, 400, { error: 'technical text is silent' })
          return
        }
        if (!ttsConfigured()) {
          sendJson(res, 503, { error: 'tts not configured', code: 'tts-unconfigured',
                               fallback: 'clips' })
          return
        }
        const stream = url.searchParams.get('stream') === '1'
        try {
          if (stream) {
            const { response, elapsedMs } = await synthStreamFetch(text)
            res.writeHead(200, {
              'content-type': 'audio/L16;rate=32000;channels=1',
              'cache-control': 'no-store',
              'x-muelsyse-ttfb-ms': String(elapsedMs),
            })
            const reader = response.body.getReader()
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              if (!res.write(Buffer.from(value))) {
                await new Promise((resolve) => res.once('drain', resolve))
              }
            }
            res.end()
          } else {
            const wav = await synthWav(text)
            res.writeHead(200, { 'content-type': 'audio/wav',
                                 'content-length': String(wav.length),
                                 'cache-control': 'no-store' })
            res.end(wav)
          }
        } catch (error) {
          sendJson(res, 503, { error: String(error?.message || error).slice(0, 160),
                               fallback: 'clips' })
        }
        return
      }

      sendJson(res, 404, { error: 'not found', path: url.pathname })
    },
  }))
}
