/**
 * zh→ja 翻译通道（DeepSeek 官方 API）。
 *
 * key 来源，按顺序：
 *   1. process.env.MUELSYSE_TRANSLATE_API_KEY（进程环境）
 *   2. HKCU\Environment 的同名用户变量（DSH 主进程可能没继承到，插件自己读一次，仅内存）
 * 红线：key 不落日志、不落回报、不进仓库；只在内存里用于 Authorization 头。
 * 401 / 超时 / 解析失败 → 返回 null，调用方按降级梯静默并计 missing。
 */
import { execFileSync } from 'node:child_process'

const ENV_NAME = 'MUELSYSE_TRANSLATE_API_KEY'
const API_BASE = process.env.MUELSYSE_TRANSLATE_API || 'https://api.deepseek.com'
const MODEL = process.env.MUELSYSE_TRANSLATE_MODEL || 'deepseek-flash'
const TIMEOUT_MS = Number(process.env.MUELSYSE_TRANSLATE_TIMEOUT_MS || 20000) || 20000

const GLOSSARY = [
  ['博士', 'ドクター'], ['罗德岛', 'ロドス'], ['莱茵生命', 'ライン生命'], ['莱茵', 'ライン'],
  ['缪尔赛思', 'ミュルジス'], ['生态科', '生態課'], ['生态学', '生態学'], ['精灵', 'エルフ'],
  ['巨兽', '巨獣'], ['结晶', '結晶'], ['琥珀', '琥珀'], ['萨米', 'サーミ'],
  ['麦哲伦', 'マゼラン'], ['克丽斯腾', 'クリステン'], ['明日方舟', 'アークナイツ'],
]
const SYSTEM = [
  'あなたは中国語を日本語に翻訳する専門家です。',
  '次の用語集に必ず従ってください：' + GLOSSARY.map(([zh, ja]) => `${zh}→${ja}`).join('、') + '。',
  '口語的で自然な日本語にし、原文の固有名詞・数字・語順は保つこと。',
  '出力は日本語訳のみ。説明・ローマ字・原文・引用符は書かない。',
].join('')

let keyCache
const translationCache = new Map()

function readUserEnv(name) {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    })
    const match = out.match(new RegExp(name + '\\s+REG_[A-Z_]+\\s+(.+)'))
    return match ? match[1].trim() : ''
  } catch {
    return ''
  }
}

function apiKey() {
  if (keyCache !== undefined) return keyCache
  const fromEnv = process.env[ENV_NAME]
  keyCache = fromEnv && fromEnv.trim() !== '' ? fromEnv.trim() : readUserEnv(ENV_NAME)
  return keyCache
}

export function channelStatus() {
  if (!apiKey()) {
    return { available: false, channel: 'none', reason: 'no key (env/User scope both empty)' }
  }
  return { available: true, channel: 'deepseek-api', model: MODEL }
}

/** 把一段中文译成日文；失败返回 null（调用方降级，不抛错）。 */
export async function translateToJa(text, context = '') {
  const key = apiKey()
  if (!key || !text) return null
  const cacheKey = context ? context + '\u0000' + text : text
  const cached = translationCache.get(cacheKey)
  if (cached !== undefined) return cached
  try {
    const response = await fetch(API_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: context ? ('前文：\n' + context + '\n\n次の文だけを訳す：\n' + text) : text }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 401) {
      keyCache = ''
      return null
    }
    if (!response.ok) return null
    const data = await response.json()
    const out = data?.choices?.[0]?.message?.content
    if (typeof out !== 'string') return null
    const clean = out.trim().replace(/^["「『]|["」』]$/g, '').trim()
    if (clean === '') return null
    translationCache.set(cacheKey, clean)
    if (translationCache.size > 200) translationCache.delete(translationCache.keys().next().value)
    return clean
  } catch {
    return null
  }
}

/** 一次请求译多句：编号输入，编号输出；解析失败返回全 null。 */
export async function translateToJaBatch(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return []
  if (texts.length === 1) return [await translateToJa(texts[0])]
  const key = apiKey()
  if (!key) return texts.map(() => null)
  const numbered = texts.map((text, index) => `${index + 1}. ${text}`).join('\n')
  const system = SYSTEM + '入力が番号付きの複数行なら、同じ番号と同じ行数で、訳文だけを改行区切りで出力する。番号は残す。'
  try {
    const response = await fetch(API_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [{ role: 'system', content: system }, { role: 'user', content: numbered }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 401) {
      keyCache = ''
      return texts.map(() => null)
    }
    if (!response.ok) return texts.map(() => null)
    const data = await response.json()
    const out = data?.choices?.[0]?.message?.content
    if (typeof out !== 'string') return texts.map(() => null)
    const byIndex = new Map()
    for (const line of out.split('\n')) {
      const match = line.trim().match(/^([0-9]+)[.、)]\s*(.+)$/)
      if (match) byIndex.set(Number(match[1]) - 1, match[2].trim())
    }
    return texts.map((text, index) => {
      const value = byIndex.get(index)
      if (!value) return null
      translationCache.set(text, value)
      return value
    })
  } catch {
    return texts.map(() => null)
  }
}
