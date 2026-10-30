import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { synthWav } from '../synth.js'

const V1 = process.env.MUELSYSE_V1 || 'E:\\AI-theme\\muelsyse\\.assets-src\\voice\\v1'
const OUT = path.join(V1, '03-tagged', 'tts-final')
const CLIPS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'clips')
const TEXTS = [
  'こんにちは。',
  '博士、少し休みましょうか。',
  '大地に滴る雨にも、加湿器の霧にも。あなたがあたしを求める声は、いつもちゃんと聞こえるわ。',
]

await mkdir(OUT, { recursive: true })
process.env.MUELSYSE_TTS_REF = path.join(CLIPS, 'refs', 'CN_034-48k.wav')
process.env.MUELSYSE_TTS_REF_TEXT = 'ふぅ、少なくとも、あたしに触れられる人として、まだあなたがいるわね。'
process.env.MUELSYSE_TTS_SPEED = '1.0'

const rows = []
for (let i = 0; i < TEXTS.length; i += 1) {
  const t0 = Date.now()
  const wav = await synthWav(TEXTS[i])
  const name = `final-${i + 1}.wav`
  await writeFile(path.join(OUT, name), wav)
  rows.push({ file: name, text: TEXTS[i], ms: Date.now() - t0, bytes: wav.length })
  console.log(name, Date.now() - t0, 'ms', wav.length, 'B')
}
await writeFile(path.join(V1, '03-tagged', 'live-final.json'),
  JSON.stringify({ ref: 'assets/clips/refs/CN_034-48k.wav', speed: 1.0, gainDb: 2.5, rows }, null, 1), 'utf8')
