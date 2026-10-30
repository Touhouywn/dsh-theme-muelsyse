#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { channelStatus, translateToJa } from '../translate.js'

const V1 = process.env.MUELSYSE_V1 || 'E:\\AI-theme\\muelsyse\\.assets-src\\voice\\v1'
const TEXTS = ['博士，你在吗？', '今天也要好好休息。', '罗德岛的走廊里，水汽很重。']

const status = channelStatus()
console.log('channel', JSON.stringify(status))
if (!status.available) process.exit(1)

const rows = []
for (const text of TEXTS) {
  const t0 = Date.now()
  const ja = await translateToJa(text)
  rows.push({ text, ja, ms: Date.now() - t0 })
  console.log(`${Date.now() - t0}ms  ${text}  ->  ${ja}`)
}

const dir = path.join(V1, '03-tagged')
await mkdir(dir, { recursive: true })
await writeFile(path.join(dir, 'live-translate-test.json'),
  JSON.stringify({ at: new Date().toISOString(), model: status.model, rows }, null, 1), 'utf8')

const checks = [
  ['博士→ドクター', String(rows[0].ja || '').includes('ドクター')],
  ['罗德岛→ロドス', String(rows[2].ja || '').includes('ロドス')],
  ['三条都有输出', rows.every((r) => typeof r.ja === 'string' && r.ja.length > 0)],
]
let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failed += 1
}
process.exit(failed ? 1 : 0)
