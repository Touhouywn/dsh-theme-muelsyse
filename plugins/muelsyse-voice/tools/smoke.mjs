#!/usr/bin/env node
/**
 * L1 smoke — 不依赖 DSH，直接对插件静态资产做断言。
 *
 *   node tools/smoke.mjs
 *
 * 断言：catalog 37 条；id 集合与 07-release/manifest.json 一致；
 * 37 个切片存在且 sha256 与 manifest 一致；templates 无空组且 id 都在 catalog。
 * 唯一外部输入：v1 的 manifest（可用 MUELSYSE_V1 覆盖 v1 根目录）。
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const V1 = process.env.MUELSYSE_V1 || 'E:\\AI-theme\\muelsyse\\.assets-src\\voice\\v1'
const EXPECTED = 37

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`)
}

async function sha256(file) {
  const data = await readFile(file)
  return createHash('sha256').update(data).digest('hex')
}

const catalog = JSON.parse(await readFile(path.join(PLUGIN, 'assets/catalog.json'), 'utf8'))
const templates = JSON.parse(await readFile(path.join(PLUGIN, 'assets/templates.json'), 'utf8'))
const manifest = JSON.parse(await readFile(path.join(V1, '07-release/manifest.json'), 'utf8'))

const clips = Array.isArray(catalog.clips) ? catalog.clips : []
const ids = clips.map((c) => c.id)
const manifestIds = manifest.items.map((i) => `CN_${String(Number(i.prts_idx)).padStart(3, '0')}`)
const idSet = new Set(ids)

check('catalog.version=2.1', Number(catalog.version) === 2.1, String(catalog.version))
check('cnText 全有', clips.every((c) => typeof c.cnText === 'string' && c.cnText.length > 0),
  `${clips.filter((c) => !c.cnText).length} 条缺`)
check(`catalog ${EXPECTED} 条`, clips.length === EXPECTED, String(clips.length))
check('id 唯一', idSet.size === ids.length, `${idSet.size}/${ids.length}`)
check('id 与 manifest 一致',
  idSet.size === manifestIds.length && manifestIds.every((id) => idSet.has(id)),
  `catalog ${idSet.size} / manifest ${manifestIds.length}`)
check('source 字段', catalog.source === 'bilibili:BV17z421U71V', String(catalog.source))

const byId = new Map(manifest.items.map((i) => [`CN_${String(Number(i.prts_idx)).padStart(3, '0')}`, i]))
const bad = []
for (const clip of clips) {
  const file = path.join(PLUGIN, 'assets', clip.file)
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    const got = await sha256(file)
    const want = byId.get(clip.id)?.sha256
    if (got !== want) bad.push(`${clip.id} sha ${got.slice(0, 12)} != ${String(want).slice(0, 12)}`)
  } catch (err) {
    bad.push(`${clip.id} ${err.message}`)
  }
}
check('37 个文件 sha256 一致', bad.length === 0, bad.slice(0, 3).join('; '))

const groups = Array.isArray(templates.templates) ? templates.templates : []
const emptyGroups = groups.filter((t) => !Array.isArray(t.ids) || t.ids.length === 0)
const strayIds = groups.flatMap((t) => (t.ids || []).filter((id) => !idSet.has(id)))
check('templates 非空组', groups.length > 0 && emptyGroups.length === 0,
  `${groups.length} 组，空 ${emptyGroups.length}`)
check('templates id 都在 catalog', strayIds.length === 0, strayIds.slice(0, 3).join('; '))

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
if (failed.length) {
  console.log('见上方 FAIL 行')
  process.exit(1)
}
