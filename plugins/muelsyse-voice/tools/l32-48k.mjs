import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { synthWav } from '../synth.js'

const V1 = process.env.MUELSYSE_V1 || 'E:\\AI-theme\\muelsyse\\.assets-src\\voice\\v1'
const OUT = path.join(V1, '03-tagged', 'tts-samples')
const CLIPS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'clips')
const TEXTS = [
  'こんにちは。',
  '大地に滴る雨にも、加湿器の霧にも。あなたがあたしを求める声は、いつもちゃんと聞こえるわ。',
]
const REF_TEXT = 'ふぅ、少なくとも、あたしに触れられる人として、まだあなたがいるわね。'

await mkdir(OUT, { recursive: true })
process.env.MUELSYSE_TTS_REF = path.join(CLIPS, 'refs', 'CN_034-48k.wav')
process.env.MUELSYSE_TTS_REF_TEXT = REF_TEXT
process.env.MUELSYSE_TTS_SPEED = '1.0'

const rows = []
for (const [i, text] of [[1, TEXTS[0]], [3, TEXTS[1]]]) {
  const t0 = Date.now()
  const wav = await synthWav(text)
  const name = `L3.2-48k-${i}.wav`
  await writeFile(path.join(OUT, name), wav)
  rows.push({ file: name, text, ms: Date.now() - t0, bytes: wav.length })
  console.log(name, Date.now() - t0, 'ms', wav.length, 'B')
}
await writeFile(path.join(V1, '03-tagged', 'live-L3.2-48k.json'),
  JSON.stringify({ ref: 'assets/clips/refs/CN_034-48k.wav', speed: 1.0, rows }, null, 1), 'utf8')
