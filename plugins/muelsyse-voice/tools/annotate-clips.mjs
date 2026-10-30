#!/usr/bin/env node
/**
 * annotate-clips.mjs — 把新切片接进缪尔赛思的语义检索体系，只改数据、不改代码。
 *
 * 背景
 *   宿主默认 /speak 已经不再翻译 + SoVITS，而是「中文关键词 → 意图 → 类内
 *   Dice 检索 → 播库存切片」。所以新增一条切片只需要两件事：
 *     1. 把切片登记进 assets/catalog.json（id/file/text/asrText/cnText/duration/version）
 *     2. 把 id 填进 assets/intents.json 对应意图的 clipIds（必要的话改 default）
 *   index.js 在启动时读一次 intents.json，没有任何按 id 写死的分支。
 *
 * 典型流程（voicekit，一条本地链路，不联网）
 *   $vk = "C:\Users\yuanshuifehe\.dsh\voicekit\voicekit.cmd"
 *   & $vk wav  D:\素材\full.wav        D:\工作\in.wav
 *   & $vk vad  D:\工作\in.wav          D:\工作\segments.json
 *   & $vk cut  D:\工作\in.wav          D:\工作\segments.json  D:\工作\clips
 *   & $vk asr  D:\工作\clips           D:\工作\asr.json
 *   # 人工抽听 + 双模型互校后，把切片转成 ogg、补 cnText，登记进 catalog.json
 *   node tools/annotate-clips.mjs            # 体检 + 未归类建议
 *   node tools/annotate-clips.mjs --check    # CI 用：有问题就非零退出
 *
 * 用法
 *   node tools/annotate-clips.mjs [--check] [--json] [--catalog <path>] [--intents <path>] [--top 3]
 *
 * 检查项
 *   error   clipId 在 catalog 里不存在 / default 不在本意图 clipIds 里 /
 *           fallback 指向不存在的意图 / fallback 成环或指向自己
 *   warn    同一切片被多个意图认领（不致命，但会放大某类权重）/ 未归类切片
 *   info    空意图（default 为 null 且有 fallback 属于设计内）
 *
 * 退出码：0 = 无 error（且 --check 下也无未归类切片）；1 = 需要修；2 = 读文件失败。
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CATALOG = resolve(HERE, '..', 'assets', 'catalog.json')
const DEFAULT_INTENTS = resolve(HERE, '..', 'assets', 'intents.json')

function parseArgs(argv) {
  const args = { check: false, json: false, top: 3, catalog: DEFAULT_CATALOG, intents: DEFAULT_INTENTS }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') args.check = true
    else if (arg === '--json') args.json = true
    else if (arg === '--top') {
      const value = Number(argv[i + 1])
      if (Number.isFinite(value)) args.top = Math.max(1, Math.min(5, Math.trunc(value)))
      i += 1
    } else if (arg === '--catalog') {
      args.catalog = resolve(argv[i + 1] || DEFAULT_CATALOG)
      i += 1
    } else if (arg === '--intents') {
      args.intents = resolve(argv[i + 1] || DEFAULT_INTENTS)
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else {
      console.error(`未知参数：${arg}`)
      args.help = true
    }
  }
  return args
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function bigrams(value) {
  const chars = [...value]
  if (chars.length === 0) return new Set()
  if (chars.length === 1) return new Set([chars[0]])
  const out = new Set()
  for (let i = 0; i < chars.length - 1; i += 1) out.add(chars[i] + chars[i + 1])
  return out
}

function dice(a, b) {
  const ga = bigrams(normalize(a))
  const gb = bigrams(normalize(b))
  if (ga.size === 0 || gb.size === 0) return 0
  let hit = 0
  for (const gram of ga) if (gb.has(gram)) hit += 1
  return (2 * hit) / (ga.size + gb.size)
}

/** 简易意图匹配分：cnText 里真出现的关键词给权重，再补一个整体 Dice。 */
function intentScore(cnText, keywords) {
  const clean = normalize(cnText)
  const hits = []
  let weight = 0
  for (const keyword of Array.isArray(keywords) ? keywords : []) {
    const key = normalize(keyword)
    if (key === '' || !clean.includes(key)) continue
    if (hits.some((other) => other.includes(key))) continue
    hits.push(key)
    weight += 0.6 + 0.2 * key.length
  }
  const joined = (Array.isArray(keywords) ? keywords : []).join('')
  const score = weight + 0.4 * dice(cnText, joined)
  return { score, hits }
}

function rankIntents(clip, intents, top) {
  const ranked = []
  for (const [name, def] of Object.entries(intents?.intents || {})) {
    const { score, hits } = intentScore(clip?.cnText || '', def?.keywords)
    if (score <= 0) continue
    ranked.push({ intent: name, label: def?.label || name, score: Number(score.toFixed(3)), hits })
  }
  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, top)
}

/** 空意图的候选切片：把全部切片的 cnText 与该意图关键词比一遍。 */
function rankClipsForIntent(name, def, clips, top) {
  const ranked = []
  for (const clip of clips) {
    const { score, hits } = intentScore(clip?.cnText || '', def?.keywords)
    if (score <= 0) continue
    ranked.push({ id: clip.id, cnText: String(clip.cnText || '').slice(0, 32), score: Number(score.toFixed(3)), hits })
  }
  ranked.sort((a, b) => b.score - a.score)
  return { intent: name, label: def?.label || name, fallback: def?.fallback ?? null, suggestions: ranked.slice(0, top) }
}

function summarize(text, size = 34) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length > size ? clean.slice(0, size) + '…' : clean
}

function usage() {
  console.log([
    '用法：node tools/annotate-clips.mjs [--check] [--json] [--top N]',
    '',
    '  --check   有问题就非零退出（CI / 落盘前自检）',
    '  --json    输出机器可读报告',
    '  --top N   每个未归类切片给 N 条意图建议（默认 3）',
    '',
    '新增切片：voicekit 切好 → 登记 catalog.json → 把 id 加进 intents.json 的 clipIds',
    '（或改 default）→ 再跑本脚本，绿灯即可，index.js 不需要动。',
  ].join('\n'))
}

async function loadJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`读不到 ${label}：${path}（${error?.message || error}）`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return 0
  }
  return Promise.all([
    loadJson(args.catalog, 'catalog.json'),
    loadJson(args.intents, 'intents.json'),
  ]).then(([catalog, intents]) => {
    const clips = Array.isArray(catalog?.clips) ? catalog.clips : []
    const defs = intents?.intents && typeof intents.intents === 'object' ? intents.intents : {}
    const byId = new Map()
    const errors = []
    const warnings = []

    for (const clip of clips) {
      if (!clip || typeof clip.id !== 'string' || clip.id === '') {
        errors.push({ kind: 'catalog', message: '存在没有 id 的切片' })
        continue
      }
      if (byId.has(clip.id)) errors.push({ kind: 'catalog', message: `catalog 里 id 重复：${clip.id}`, id: clip.id })
      byId.set(clip.id, clip)
    }

    const owner = new Map() // clipId → [intent...]
    const assignment = new Map() // intent → {ids, missing, default}
    for (const [name, def] of Object.entries(defs)) {
      const ids = Array.isArray(def?.clipIds) ? def.clipIds : []
      const missing = ids.filter((id) => !byId.has(id))
      for (const id of missing) {
        errors.push({ kind: 'clip-id', intent: name, id, message: `意图 ${name} 的 clipIds 里有不存在的切片：${id}` })
      }
      if (def?.default != null) {
        if (!ids.includes(def.default)) {
          errors.push({ kind: 'default', intent: name, id: def.default,
            message: `${name}.default = ${def.default} 不在 clipIds 里（默认代表切片必须是本意图成员）` })
        } else if (!byId.has(def.default)) {
          errors.push({ kind: 'default', intent: name, id: def.default,
            message: `${name}.default = ${def.default} 在 catalog 里不存在` })
        }
      }
      if (def?.fallback != null) {
        if (def.fallback === name) errors.push({ kind: 'fallback', intent: name, message: `${name}.fallback 指向自己` })
        else if (!defs[def.fallback]) {
          errors.push({ kind: 'fallback', intent: name, message: `${name}.fallback 指向不存在的意图：${def.fallback}` })
        }
      }
      for (const id of ids) {
        if (!owner.has(id)) owner.set(id, [])
        owner.get(id).push(name)
      }
      assignment.set(name, { def, ids, missing })
    }

    // fallback 环检测
    for (const name of Object.keys(defs)) {
      const seen = new Set([name])
      let current = defs[name]?.fallback
      let depth = 0
      while (current && depth < 8) {
        if (seen.has(current)) {
          errors.push({ kind: 'fallback-cycle', intent: name, message: `fallback 成环：${[...seen, current].join(' → ')}` })
          break
        }
        seen.add(current)
        current = defs[current]?.fallback
        depth += 1
      }
    }

    for (const [id, owners] of owner) {
      if (owners.length > 1) {
        warnings.push({ kind: 'duplicate', id, owners,
          message: `${id} 同时属于 ${owners.join(' / ')}（允许，但会让该类权重偏高）` })
      }
    }

    const unassigned = clips
      .filter((clip) => typeof clip.id === 'string' && !owner.has(clip.id))
      .map((clip) => ({ id: clip.id, cnText: clip.cnText || '', suggestions: rankIntents(clip, intents, args.top) }))
    for (const clip of unassigned) {
      warnings.push({ kind: 'unassigned', id: clip.id, message: `未归类：${clip.id}（${summarize(clip.cnText)}）` })
    }

    const empty = []
    for (const [name, entry] of assignment) {
      if (entry.ids.length > 0) continue
      empty.push(rankClipsForIntent(name, entry.def, clips, args.top))
    }

    const report = {
      ok: errors.length === 0 && unassigned.length === 0,
      catalog: { path: args.catalog, clips: clips.length },
      intents: { path: args.intents, count: Object.keys(defs).length },
      groups: intents?.groups || {},
      assigned: clips.filter((clip) => typeof clip.id === 'string' && owner.has(clip.id)).length,
      errors,
      warnings,
      unassigned,
      empty,
    }

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      printReport(report, defs)
    }

    const failed = errors.length > 0 || (args.check && unassigned.length > 0)
    return failed ? 1 : 0
  })
}

function printReport(report, defs) {
  const lines = []
  lines.push(`catalog  ${report.catalog.path}`)
  lines.push(`intents  ${report.intents.path}`)
  lines.push(`切片 ${report.catalog.clips} 条 · 意图 ${report.intents.count} 个 · 已归类 ${report.assigned}/${report.catalog.clips}`)
  lines.push('')

  if (report.groups && Object.keys(report.groups).length > 0) {
    lines.push('分组：')
    for (const [key, group] of Object.entries(report.groups)) {
      const members = Object.entries(defs).filter(([, def]) => def?.group === key)
        .map(([name]) => name)
      lines.push(`  ${key.padEnd(10)} ${String(group?.label || '').padEnd(6)} ${members.join(', ')}`)
    }
    lines.push('')
  }

  if (report.errors.length > 0) {
    lines.push(`ERROR ${report.errors.length}`)
    for (const item of report.errors) lines.push(`  ✗ ${item.message}`)
    lines.push('')
  }
  if (report.warnings.length > 0) {
    lines.push(`WARN ${report.warnings.length}`)
    for (const item of report.warnings) lines.push(`  · ${item.message}`)
    lines.push('')
  }

  if (report.unassigned.length > 0) {
    lines.push('未归类切片（新切片先看这里）：')
    for (const item of report.unassigned) {
      lines.push(`  ${item.id}  ${summarize(item.cnText)}`)
      if (item.suggestions.length === 0) {
        lines.push('      没有关键词命中：先给意图补 keywords，或直接手动归到最接近的类。')
        lines.push('')
        continue
      }
      for (const suggestion of item.suggestions) {
        const hit = suggestion.hits.length > 0 ? `命中：${suggestion.hits.join('、')}` : '仅整体相似'
        lines.push(`      → ${suggestion.intent.padEnd(12)} ${String(suggestion.score).padEnd(5)} ${hit}`)
      }
      const best = item.suggestions[0]
      const def = defs[best.intent]
      const nextIds = [...(Array.isArray(def?.clipIds) ? def.clipIds : []), item.id]
      lines.push(`      粘贴：${JSON.stringify(best.intent)}: "clipIds": ${JSON.stringify(nextIds)}`)
      if (def?.default == null) lines.push(`      顺手把 default 设成 ${JSON.stringify(item.id)}（该意图原本没有代表切片）`)
      lines.push('')
    }
  }

  if (report.empty.length > 0) {
    lines.push('空意图（已用 fallback 兜住，属于设计内；有对应台词再补）：')
    for (const item of report.empty) {
      const tail = item.fallback ? `fallback → ${item.fallback}` : 'fallback 空缺'
      lines.push(`  ${item.intent.padEnd(12)} ${String(item.label || '').padEnd(6)} ${tail}`)
      for (const suggestion of item.suggestions) {
        lines.push(`      候选 ${suggestion.id}（${suggestion.hits.join('、') || '整体相似'}） ${summarize(suggestion.cnText)}`)
      }
    }
    lines.push('')
  }

  lines.push(report.ok ? '结论：绿灯。新切片已全部归类，无结构错误。'
    : (report.errors.length > 0
      ? '结论：有结构错误，先修 errors。'
      : '结论：结构没问题，但还有切片没归类（--check 下算失败）。'))
  console.log(lines.join('\n'))
}

main().then((code) => {
  process.exitCode = code
}).catch((error) => {
  console.error(String(error?.message || error))
  process.exitCode = 2
})
