#!/usr/bin/env node
/**
 * L3.1 重制：CN_018 作主参考，speed 1.0 / 0.9 × 3 段；旧档 CN_034@0.9 同增益重出。
 * 合成侧 +2.5 dB（synth.js MUELSYSE_TTS_GAIN_DB，默认 2.5）。
 *
 *   node tools/l31-render.mjs
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

async function render(tag, refFile, speed, text, outName) {
  process.env.MUELSYSE_TTS_REF = path.join(CLIPS, refFile)
  process.env.MUELSYSE_TTS_SPEED = String(speed)
  const started = Date.now()
  const wav = await synthWav(text)
  const ms = Date.now() - started
  await writeFile(path.join(OUT, outName), wav)
  rows.push({ tag, ref: refFile, speed, text, file: outName, ms, bytes: wav.length })
  console.log(`${tag} ${refFile} x${speed}: ${ms}ms  ${wav.length}B  ${text.slice(0, 18)}`)
}

for (const [speed, label] of [[1.0, 's10'], [0.9, 's09']]) {
  for (let i = 0; i < TEXTS.length; i += 1) {
    await render(`new-${label}`, 'CN_018.wav', speed, TEXTS[i], `L3.1-${i + 1}-${label}.wav`)
  }
}
for (let i = 0; i < TEXTS.length; i += 1) {
  await render('old', 'CN_034.wav', 0.9, TEXTS[i], `L3.1-old-${i + 1}.wav`)
}

await writeFile(path.join(V1, '03-tagged', 'live-L3.1-timings.json'),
  JSON.stringify({ at: new Date().toISOString(), gainDb: Number(process.env.MUELSYSE_TTS_GAIN_DB || 2.5), rows }, null, 1), 'utf8')
console.log('done', rows.length)
