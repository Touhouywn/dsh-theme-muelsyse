/**
 * Muelsyse · voice — semantic planner (host half, pure functions).
 *
 * Zero token, zero network: a Chinese keyword classifier maps one reply
 * sentence to an intent declared in assets/intents.json, then a Dice
 * comparison inside that intent's clip pool picks the closest recorded line.
 * Nothing here calls the translation API or the SoVITS server; the legacy
 * translate → synth pipeline only runs when /speak is called with synth:true.
 *
 * Degrade ladder per sentence: match → default/rotate → echo → silent.
 * The old ladder ended in "filler" and therefore played CN_025 for every
 * unmatched sentence. It no longer does: an unmatched sentence with no literal
 * echo stays silent, and a pool with several usable clips rotates through them
 * instead of replaying `default` forever. `filler` is a real intent now, not a
 * universal fallback (opt back in with settings.fillerOnMiss = true).
 *
 * Rotation memory (recentClips) lives in this module and is only touched by
 * buildSemanticPlan; the resolve* helpers stay pure functions that accept the
 * memory through options.recent, so tools/ and node --check can exercise them
 * without a DSH process.
 */

const JA_RE = /[\u3040-\u30ff]/
const DEFAULT_ROUTE = '/muelsyse-voice'
const DEFAULT_MIN_SCORE = 0.18
const DEFAULT_ECHO_SCORE = 0.5
const RECENT_LIMIT = 8

/** 与 pipeline/norm_ja.py 同口径的日文归一。 */
export function normalizeJa(text) {
  const kept = String(text || '')
    .normalize('NFKC')
    .replace(/[^\u3040-\u30ff\u4e00-\u9fffA-Za-z0-9]/g, '')
  let out = ''
  for (const ch of kept) {
    if (ch === '\u30fc') continue
    const code = ch.codePointAt(0)
    out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch
  }
  return out
}

/** 中文归一：NFKC → 小写 → 只留字母/数字（含汉字、假名），标点空白全去。 */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

export function isJapanese(text) {
  return JA_RE.test(String(text ?? ''))
}

export function bigrams(value) {
  const chars = [...String(value ?? '')]
  if (chars.length === 0) return new Set()
  if (chars.length === 1) return new Set([chars[0]])
  const out = new Set()
  for (let i = 0; i < chars.length - 1; i += 1) out.add(chars[i] + chars[i + 1])
  return out
}

export function dice(a, b) {
  const ga = bigrams(a)
  const gb = bigrams(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let hit = 0
  for (const gram of ga) if (gb.has(gram)) hit += 1
  return (2 * hit) / (ga.size + gb.size)
}

/** 2-gram Dice（日文侧，假名折平假名）。 */
export function jaDice(a, b) {
  return dice(normalizeJa(a), normalizeJa(b))
}

/** 2-gram Dice（中文侧）。 */
export function cnDice(a, b) {
  return dice(normalizeText(a), normalizeText(b))
}

/**
 * 代码内补充触发词：intents.json 由另一个任务维护，这里只补「常用口语说法」，
 * 不改数据文件。同一意图的触发词会与 JSON 里的 keywords 合并，分类与
 * 关键词回扣（keywordRate）共用这一份。单字词只保留「嗯 / 唔」这类无歧义语气词，
 * 避免「行」「好」在「行业」「很好」里误命中。
 */
const EXTRA_KEYWORDS = {
  greeting: ['你好啊', '你好呀', '早安呀', '嗨嗨', '在吗在吗'],
  farewell: ['再见啦', '拜拜啦', '回头见', '下次聊', '我下线了', '先这样', '晚安啦', 'おやすみ'],
  thanks: ['谢谢啦', '谢谢您', '多谢了', '太感谢', '感谢你', 'ありがとうございます'],
  apology: ['我的错', '是我不对', '抱歉了', '对不起啊', '失礼了', 'ごめんなさい', '申し訳'],
  affirm: ['好哒', '好嘞', '行呀', '可以啊', '没问题呀', '当然可以', 'ok', '收到啦', '遵命'],
  negate: ['不行哦', '不要啊', '不用了', '算了', '不是啦', '不会的'],
  agree: ['说得对', '确实如此', '我同意', '赞同', '有道理', '是这样的'],
  disagree: ['我不觉得', '不一定', '我不太同意', '恕难同意', '不同意'],
  confused: ['不懂', '没懂', '不明白', '不理解', '什么意思', '啥意思', '为什么', '怎么了',
    '怎么回事', '迷糊', 'わからない', '分からない', 'どういうこと'],
  understand: ['懂了', '明白了', '了解了', '知道了', '理解', '原来如此', 'わかった',
    'なるほど', 'そうなんだ'],
  happy: ['开心', '高兴', '太好了', '好耶', '喜欢', '太棒了', '真好', '愉快', '快乐',
    '嬉しい', '楽しい', 'うれしい'],
  comfort: ['别难过', '没事的', '没关系', '别担心', '放心', '别怕', '别急', '慢慢来',
    '我在呢', '有我在', '陪着你', '大丈夫'],
  encourage: ['加油', '你可以的', '一定可以', '别放弃', '努力', '坚持', '挺住', '振作',
    '頑張って', 'がんばれ'],
  praise: ['厉害', '了不起', '优秀', '做得好', '真棒', '太强了', '佩服', '聪明',
    'すごい', 'えらい'],
  worry: ['担心', '忧虑', '不安', '害怕', '危险', '小心', '糟糕', '怎么办', '要紧',
    '心配'],
  filler: ['怎么说呢', '这样啊', '唔', '嗯', '话说', '那个', 'あの', 'えっと'],
  thinking: ['让我想想', '我想想', '想想', '思考', '我在想', '考虑一下', '琢磨', '想一想',
    '回忆', 'ええと', '考え'],
  confirm: ['在听', '我在听', '听得到', '听到了', '是吗', '对吧', '怎么样', '好不好',
    '行吗', '对吗', '可以吗', '是吧'],
  remind: ['记得', '别忘了', '提醒', '注意', '休息', '照顾好自己', '按时', '小心点',
    '记一下', '早点睡'],
  invite: ['要不要', '一起', '来吗', '陪我', '请你', '邀请', '试试', '帮我', '走吧',
    '散步', '来看看', '一起去', '一緒に', '手を貸して'],
}

/** 某意图的全部触发词：JSON keywords + 代码补充词，去重保序。 */
export function intentKeywords(intents, name) {
  const def = intents?.intents?.[name]
  const base = Array.isArray(def?.keywords) ? def.keywords : []
  const extra = EXTRA_KEYWORDS[name] || []
  const out = []
  const seen = new Set()
  for (const word of base.concat(extra)) {
    const key = normalizeText(word)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/**
 * 关键词命中：长词优先，被更长命中包含的短词不重复计分。
 * 权重 = 1 + 0.5 × (字数 − 1)，3 字词比 2 字词更"有主见"。
 */
export function matchKeywords(text, keywords) {
  const clean = normalizeText(text)
  if (clean === '') return []
  const found = []
  for (const keyword of Array.isArray(keywords) ? keywords : []) {
    const key = normalizeText(keyword)
    if (key === '' || !clean.includes(key)) continue
    found.push(key)
  }
  found.sort((a, b) => b.length - a.length)
  const kept = []
  for (const key of found) {
    if (kept.some((other) => other.includes(key))) continue
    kept.push(key)
  }
  return kept.map((key) => ({ keyword: key, weight: 1 + 0.5 * (key.length - 1) }))
}

function emptyClassification(intents) {
  const def = intents?.intents?.filler
  return {
    intent: 'filler',
    label: def?.label || 'filler',
    group: def?.group || 'management',
    score: 0,
    hits: [],
    matched: false,
    forced: false,
  }
}

/**
 * 中文关键词 → intent。纯规则，同分时按 intents.json 的 priority 决出。
 * 没有任何命中 → matched:false（调用方走回声/静默，绝不默认填 filler）。
 */
export function classifyIntent(text, intents) {
  const defs = intents?.intents
  const clean = normalizeText(text)
  if (!defs || clean === '') return emptyClassification(intents)
  let best = null
  for (const [name, def] of Object.entries(defs)) {
    if (!def || typeof def !== 'object') continue
    const hits = matchKeywords(clean, intentKeywords(intents, name))
    if (hits.length === 0) continue
    const score = hits.reduce((sum, hit) => sum + hit.weight, 0)
    const priority = Number.isFinite(Number(def.priority)) ? Number(def.priority) : 0
    if (best === null || score > best.score + 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 && priority > best.priority)) {
      best = {
        intent: name,
        label: def.label || name,
        group: def.group || '',
        score: Number(score.toFixed(3)),
        priority,
        hits: hits.map((hit) => hit.keyword),
        matched: true,
        forced: false,
      }
    }
  }
  return best || emptyClassification(intents)
}

/** body.intent / 调试用：点名一个意图，不给关键词也不算错。 */
export function forcedIntent(name, intents) {
  const def = intents?.intents?.[name]
  if (!def) return null
  return {
    intent: name,
    label: def.label || name,
    score: 1,
    priority: Number.isFinite(Number(def.priority)) ? Number(def.priority) : 0,
    hits: [],
    matched: true,
    forced: true,
  }
}

/** intent → 失败回退链（含自身），最多四跳，遇到环就停。 */
export function intentChain(intents, name, max = 4) {
  const out = []
  let current = name
  while (current && out.length < max && intents?.intents?.[current]) {
    if (out.includes(current)) break
    out.push(current)
    current = intents.intents[current].fallback || null
  }
  return out
}

function lookupClip(bank, id) {
  if (!id) return null
  return bank?.byId?.get?.(id) || (bank?.clips || []).find((clip) => clip.id === id) || null
}

/** intents.json 的 clipIds → 真正存在的切片（未知 id 自动忽略，annotate 脚本会报）。 */
export function clipsFor(bank, intents, name) {
  const ids = intents?.intents?.[name]?.clipIds
  const out = []
  if (!Array.isArray(ids)) return out
  for (const id of ids) {
    const clip = lookupClip(bank, id)
    if (clip) out.push(clip)
  }
  return out
}

/**
 * 关键词回扣：命中的触发词真的出现在这条切片的 cnText 里吗？
 * hits 是分类器留下的关键词字符串（已去重、长词优先），权重按字数复算，
 * 与 matchKeywords 同一口径。
 */
function keywordRate(hits, cnText) {
  const clean = normalizeText(cnText)
  if (clean === '') return 0
  let total = 0
  let found = 0
  for (const hit of Array.isArray(hits) ? hits : []) {
    const key = normalizeText(typeof hit === 'string' ? hit : hit?.keyword)
    if (key === '') continue
    const weight = 1 + 0.5 * (key.length - 1)
    total += weight
    if (clean.includes(key)) found += weight
  }
  if (!(total > 0)) return 0
  return found / total
}

/**
 * 类内相似度：中文回复比 cnText，日文回复比原句（text/asrText），
 * 再加关键词回扣——命中的触发词真的出现在这条切片的 cnText 里才加分。
 */
export function scoreClip(sentence, clip, cls) {
  const ja = isJapanese(sentence)
  const cn = cnDice(sentence, clip?.cnText || '')
  const jaScore = ja
    ? Math.max(jaDice(sentence, clip?.text || ''), jaDice(sentence, clip?.asrText || ''))
    : 0
  const kw = keywordRate(Array.isArray(cls?.hits) ? cls.hits : [], clip?.cnText || '')
  const score = ja ? 0.70 * jaScore + 0.15 * cn + 0.15 * kw : 0.70 * cn + 0.30 * kw
  return { score, cn, ja: jaScore, kw }
}

/** 近期播放记忆（anti-repeat）。只由 buildSemanticPlan 写，其它函数只读。 */
const recentClips = []

/** 测试 / 重新开始：清空近期播放记忆。 */
export function resetRotation() {
  recentClips.length = 0
}

function rememberClip(id) {
  if (!id) return
  const index = recentClips.indexOf(id)
  if (index !== -1) recentClips.splice(index, 1)
  recentClips.push(id)
  while (recentClips.length > RECENT_LIMIT) recentClips.shift()
}

function asRecent(value) {
  if (value instanceof Set) return value
  if (Array.isArray(value)) return new Set(value)
  return new Set()
}

/** 新切片可能还没写 duration（annotate 补数据之前），排序时按 0 处理。 */
function clipDuration(clip) {
  const value = Number(clip?.duration)
  return Number.isFinite(value) ? value : 0
}

/** 回退排序键：先避开近期播放过的切片，同一条意图的 default 优先，再看分数。 */
function rotateRank(entry, recent) {
  const fresh = recent.has(entry.clip.id) ? 0 : 1
  const isDefault = entry.def?.default === entry.clip.id ? 1 : 0
  const depthPenalty = Number(entry.depth) * 1e-4
  return fresh * 100 + isDefault * 10 + entry.score - depthPenalty
}

/**
 * 一次解析：回退链内按「相似度 × 命中折扣」找过阈值的最好切片；
 * 全不够 → 链内轮换（避开近期播放的切片和本回复已播的切片，default 优先）；
 * 没有可用切片 → null，由 buildSemanticPlan 决定回声/静默。
 * recent 由调用方传入（默认空集合），本函数不写任何模块状态。
 */
export function resolveSegment(bank, intents, sentence, cls, options = {}) {
  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore) : DEFAULT_MIN_SCORE
  const used = options.used instanceof Set ? options.used : new Set()
  const recent = asRecent(options.recent)
  const chain = intentChain(intents, cls.intent)

  let best = null
  chain.forEach((name, depth) => {
    const def = intents?.intents?.[name]
    const localMin = Number.isFinite(Number(def?.minScore)) ? Number(def.minScore) : minScore
    const penalty = depth === 0 ? 1 : 0.85 ** depth
    for (const clip of clipsFor(bank, intents, name)) {
      if (used.has(clip.id)) continue
      const scored = scoreClip(sentence, clip, cls)
      const adjusted = scored.score * penalty
      if (adjusted + 1e-9 < localMin) continue
      const candidate = {
        clip,
        score: scored.score,
        adjusted,
        intent: cls.intent,
        resolved: name,
        via: depth === 0 ? 'match' : 'fallback',
      }
      if (best === null) {
        best = candidate
        continue
      }
      const gap = adjusted - best.adjusted
      if (gap > 0.03) {
        best = candidate
      } else if (Math.abs(gap) <= 0.03) {
        // 近似同分时：先避开近期播过的，再优先更短的切片
        const freshNew = !recent.has(clip.id)
        const freshOld = !recent.has(best.clip.id)
        if (freshNew !== freshOld) {
          if (freshNew) best = candidate
        } else if (clipDuration(clip) < clipDuration(best.clip)) {
          best = candidate
        }
      }
    }
  })
  if (best !== null) return best

  // 类内轮换：所有切片都低于阈值时不再固定吐 default，而是按「未播过 > default > 分数」挑。
  const pool = []
  chain.forEach((name, depth) => {
    const def = intents?.intents?.[name]
    for (const clip of clipsFor(bank, intents, name)) {
      if (used.has(clip.id)) continue
      pool.push({
        clip,
        def,
        depth,
        name,
        score: scoreClip(sentence, clip, cls).score,
      })
    }
  })
  if (pool.length === 0) return null
  pool.sort((a, b) => {
    const rank = rotateRank(b, recent) - rotateRank(a, recent)
    if (Math.abs(rank) > 1e-9) return rank
    return clipDuration(a.clip) - clipDuration(b.clip)
  })
  const pick = pool[0]
  return {
    clip: pick.clip,
    score: pick.score,
    adjusted: 0,
    intent: cls.intent,
    resolved: pick.name,
    via: pick.def?.default === pick.clip.id ? 'default' : 'rotate',
  }
}

/** filler 专用轮换：只有明确命中 filler，或显式开启 fillerOnMiss 时才会走到这里。 */
export function resolveFiller(bank, intents, sentence, cls, used = new Set(), recent = new Set()) {
  const memory = asRecent(recent)
  const pool = []
  for (const name of intentChain(intents, 'filler')) {
    const def = intents?.intents?.[name]
    for (const clip of clipsFor(bank, intents, name)) {
      if (used.has(clip.id)) continue
      pool.push({ clip, def, depth: 0, score: scoreClip(sentence, clip, cls).score, resolved: name })
    }
  }
  if (pool.length === 0) return null
  pool.sort((a, b) => {
    const rank = rotateRank(b, memory) - rotateRank(a, memory)
    if (Math.abs(rank) > 1e-9) return rank
    return clipDuration(a.clip) - clipDuration(b.clip)
  })
  const pick = pool[0]
  return {
    clip: pick.clip,
    score: pick.score,
    adjusted: 0,
    intent: 'filler',
    resolved: pick.resolved,
    via: 'filler',
  }
}

/**
 * 字面回声出口：分类器没命中，但这句话本身几乎是切片台词的复述。
 * 阈值 0.5（Dice），只在高相似时触发，避免把普通中文硬塞给某条日文切片。
 */
export function bestEcho(bank, sentence, threshold = DEFAULT_ECHO_SCORE) {
  const ja = isJapanese(sentence)
  let best = null
  for (const clip of bank?.clips || []) {
    const score = ja
      ? Math.max(jaDice(sentence, clip.text || ''), jaDice(sentence, clip.asrText || ''))
      : cnDice(sentence, clip.cnText || '')
    if (best === null || score > best.score) best = { clip, score }
  }
  if (best === null || best.score + 1e-9 < threshold) return null
  return best
}

/** 对外切片形状（与 /catalog 一致）。 */
export function publicClip(clip, route = DEFAULT_ROUTE) {
  return {
    id: clip.id,
    text: clip.text,
    duration: clip.duration,
    url: `${route}/clip/${encodeURIComponent(clip.id)}` +
      (clip.version ? `?v=${encodeURIComponent(clip.version)}` : ''),
  }
}

/** 技术句不念：代码、路径、命令一律静默，避免把日志念成台词。 */
export function technical(text) {
  return /```|`[^`]+`|https?:\/\/|[A-Za-z]:\\|(?:^|[\s"'（(])\/[\w.-]+|[\w.-]+\/[\w.-]+\.(?:js|ts|mjs|cjs|json|py|md|txt|ya?ml|ps1|sh|ogg|wav)|(?:^|[\s,，、。；;：:（(])(?:cd|npm|pnpm|git|curl|powershell|python|node|ffmpeg|dsh)\s|\{|\}|=>|function\s|<\w+[^>]*>|文件|路径|命令|代码|报错|终端|目录|配置|缓存|删除|安装|运行|执行|端口|进程|ファイル|パス|コード|コマンド|エラー|端末|設定|キャッシュ|削除|インストール|実行|ポート|プロセス/i.test(String(text || ''))
}

export function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
    .split(/[。！？!?；;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 1)
    .slice(0, 4)
}

/** options.used / body.seen：本回复已经播过的 clip，避免跨请求重播。 */
function asUsed(value) {
  if (value instanceof Set) return new Set(value)
  if (Array.isArray(value)) {
    return new Set(value.filter((id) => typeof id === 'string' && id !== '').slice(0, 32))
  }
  return new Set()
}

/**
 * 默认计划：每个非技术句 → 意图分类 → 类内检索/轮换 → clip 段。
 * 永远不产生 tts 段，也不碰翻译/合成模块。
 *
 * options.used      本回复已播切片（跨请求去重）
 * options.fillerOnMiss  true 时未命中回退到 filler 轮换；默认静默
 * options.recent    轮换记忆（测试可注入；默认用模块内记忆）
 */
export function buildSemanticPlan(bank, text, intents, options = {}) {
  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : Number.isFinite(Number(intents?.settings?.minScore))
      ? Number(intents.settings.minScore)
      : DEFAULT_MIN_SCORE
  const echoScore = Number.isFinite(Number(options.echoScore))
    ? Number(options.echoScore)
    : Number.isFinite(Number(intents?.settings?.echoScore))
      ? Number(intents.settings.echoScore)
      : DEFAULT_ECHO_SCORE
  const rawMax = Number.isFinite(Number(options.maxSegments))
    ? Number(options.maxSegments)
    : Number.isFinite(Number(intents?.settings?.maxSegments))
      ? Number(intents.settings.maxSegments)
      : 2
  const maxSegments = Math.max(1, Math.min(6, Math.trunc(rawMax)))
  const route = typeof options.route === 'string' ? options.route : DEFAULT_ROUTE
  const forced = options.intent ? forcedIntent(options.intent, intents) : null
  const fillerOnMiss = options.fillerOnMiss === true ||
    intents?.settings?.fillerOnMiss === true
  // 轮换记忆：拷贝一份本地集合，本计划内新播的切片立刻算「近期」，跨计划则写回模块记忆。
  const recent = new Set(options.recent === undefined ? recentClips : asRecent(options.recent))
  const sentences = splitSentences(text)
  const used = asUsed(options.used)
  const segments = []
  const analysis = []
  const stats = {
    sentences: sentences.length,
    segments: 0,
    match: 0,
    fallback: 0,
    default: 0,
    rotate: 0,
    filler: 0,
    echo: 0,
    silent: 0,
    skippedTechnical: 0,
    truncated: 0,
  }

  for (const sentence of sentences) {
    if (technical(sentence)) {
      stats.skippedTechnical += 1
      stats.silent += 1
      analysis.push({ text: sentence, skipped: 'technical' })
      continue
    }
    if (normalizeText(sentence) === '') {
      stats.silent += 1
      analysis.push({ text: sentence, skipped: 'empty' })
      continue
    }
    if (segments.length >= maxSegments) {
      stats.truncated += 1
      analysis.push({ text: sentence, skipped: 'truncated' })
      continue
    }

    const cls = forced || classifyIntent(sentence, intents)
    let pick = null
    if (intents && !cls.matched) {
      // 没命中：只有「这句话几乎是某条切片的复述」才出声，否则静默。
      const echo = bestEcho(bank, sentence, echoScore)
      if (echo !== null && !used.has(echo.clip.id)) {
        pick = {
          clip: echo.clip,
          score: echo.score,
          adjusted: echo.score,
          intent: cls.intent,
          resolved: cls.intent,
          via: 'echo',
        }
      }
    }
    if (pick === null && intents && cls.matched) {
      pick = resolveSegment(bank, intents, sentence, cls, { minScore, used, recent })
    }
    if (pick === null && intents && fillerOnMiss && !cls.matched) {
      // 显式开启的老行为：未命中 → filler 轮换（不再固定 CN_025）。
      pick = resolveFiller(bank, intents, sentence, cls, used, recent)
    }
    if (pick === null && !intents) {
      // intents.json 缺失时仍不出翻译：只做字面回声，阈值放宽到 0.45。
      const echo = bestEcho(bank, sentence, 0.45)
      if (echo !== null && !used.has(echo.clip.id)) {
        pick = { clip: echo.clip, score: echo.score, adjusted: echo.score,
                 intent: 'filler', resolved: 'filler', via: 'echo' }
      }
    }
    if (pick === null) {
      stats.silent += 1
      analysis.push({ text: sentence, intent: cls.intent, skipped: cls.matched ? 'no-clip' : 'no-intent' })
      continue
    }

    used.add(pick.clip.id)
    recent.add(pick.clip.id)
    rememberClip(pick.clip.id)
    stats.segments += 1
    stats[pick.via] += 1
    const pub = publicClip(pick.clip, route)
    const label = intents?.intents?.[pick.intent]?.label || pick.intent
    segments.push({
      type: 'clip',
      kind: 'clip',
      text: sentence,
      intent: pick.intent,
      intentLabel: label,
      resolvedIntent: pick.resolved,
      via: pick.via,
      id: pub.id,
      url: pub.url,
      duration: pub.duration,
      score: Number(pick.score.toFixed(3)),
      clip: pub,
    })
    analysis.push({
      text: sentence,
      intent: pick.intent,
      label,
      resolved: pick.resolved,
      via: pick.via,
      score: Number(pick.score.toFixed(3)),
    })
  }

  return {
    version: 2,
    mode: 'semantic',
    segments,
    analysis,
    stats,
    limits: { minScore, echoScore, maxSegments },
    translate: { used: false },
    synth: { used: false },
  }
}
