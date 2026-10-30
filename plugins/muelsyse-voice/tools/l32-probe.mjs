#!/usr/bin/env node
/**
 * L3.2 probe：按听感反馈（1.0 更好、CN_018 首段更差）重出默认档 + 短参考对照。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { synthWav } from '../synth.js'

const V1 = process.env.MUELSYSE_V1 || 'E:\\AI-theme\\muelsyse\\.assets-src\\voice\\v1'
const OUT = path.join(V1, '03-tagged', 'tts-samples')
const CLIPS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'clips')
const TEXTS = [
  'こんにちは。',
  '博士、少し休みましょうか。',
  '大地に滴る雨にも、加湿器の霧にも。あなたがあたしを求める声は、いつもちゃんと聞こえるわ。',
]

await mkdir(OUT, { recursive: true })
const rows = []
async function render(tag, refFile, text, outName) {
  process.env.MUELSYSE_TTS_REF = path.join(CLIPS, refFile)
  const started = Date.now()
  const wav = await synthWav(text)
  await writeFile(path.join(OUT, outName), wav)
  rows.push({ tag, ref: refFile, speed: 1.0, text, file: outName, ms: Date.now() - started, bytes: wav.length })
  console.log(`${outName}  ${Date.now() - started}ms  ${wav.length}B`)
}

for (let i = 0; i < TEXTS.length; i += 1) {
  await render('cn034', 'CN_034.wav', TEXTS[i], `L3.2-cn034-${i + 1}.wav`)
}
await render('cn024', 'CN_024.wav', TEXTS[0], 'L3.2-cn024-1.wav')

await writeFile(path.join(V1, '03-tagged', 'live-L3.2-timings.json'),
  JSON.stringify({ at: new Date().toISOString(), rows }, null, 1), 'utf8')
console.log('done', rows.length)
