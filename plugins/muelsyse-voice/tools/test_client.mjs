#!/usr/bin/env node
/**
 * L4 模拟器：不拉起 DSH，用假 DOM/fetch/Audio 跑 client.js 的三类计划。
 *
 * 断言：/speak 被调、clip 段被播、技术句不播、事件命名空间正确。
 */
const calls = { speak: [], audio: [], events: [] }
let currentText = 'あたしの助けが必要かしら？'
let observerCb = null

const clone = () => ({ textContent: currentText, querySelectorAll: () => [] })
const markdown = {
  get className() { return 'markdown' },
  get textContent() { return currentText },
  cloneNode: clone,
  parentElement: null,
}
const container = {
  className: 'centerCol',
  querySelectorAll: () => [markdown],
  parentElement: null,
}
markdown.parentElement = { className: 'assistant', parentElement: container }

const doc = {
  querySelector: (sel) => (String(sel).includes('centerCol') ? container : null),
  querySelectorAll: () => [],
  createElement: () => ({
    style: {}, setAttribute() {}, appendChild() {}, addEventListener() {},
    querySelector: () => null, remove() {},
  }),
  documentElement: { appendChild() {} },
}

class FakeAudio {
  constructor(url) { this.src = url; calls.audio.push(String(url)); this.onended = null; this.onerror = null }
  play() { setTimeout(() => { if (typeof this.onended === 'function') this.onended() }, 0); return Promise.resolve() }
  pause() {}
  addEventListener() {}
  removeEventListener() {}
}

class FakeObserver {
  constructor(cb) { observerCb = cb }
  observe() {}
  disconnect() {}
}

const resp = (obj, ok = true) => ({
  ok,
  status: ok ? 200 : 503,
  json: async () => obj,
  headers: { get: () => '' },
  body: null,
  arrayBuffer: async () => new ArrayBuffer(0),
})

function planFor(text) {
  if (/代码|路径|函数|命令/.test(text)) return { version: 1, segments: [], stats: { silent: 1 } }
  return {
    version: 1,
    segments: [{ type: 'clip', kind: 'clip', id: 'CN_022', text: 'x',
                 url: '/muelsyse-voice/clip/CN_022', duration: 3.5 }],
    stats: { clip: 1 },
  }
}

global.fetch = async (url, opts = {}) => {
  const u = String(url)
  if (u.endsWith('/status')) return resp({ clips: 37 })
  if (u.endsWith('/thinking')) return resp({ phases: { start: [], mid: [], end: [] } })
  if (u.endsWith('/speak')) {
    const body = JSON.parse(opts.body || '{}')
    calls.speak.push(String(body.text || ''))
    return resp(planFor(String(body.text || '')))
  }
  return resp({})
}

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail }
}

const windowStub = {
  __ModuleLoader__: { load: ({ factory }) => { mod = factory(() => ({})) } },
  localStorage: { getItem: () => null, setItem() {} },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent(event) { calls.events.push(event) },
  CustomEvent: FakeCustomEvent,
  __MUELSYSE_THINKING__: {},
  document: doc,
}
let mod = null
global.window = windowStub
global.document = doc
global.Audio = FakeAudio
global.MutationObserver = FakeObserver
global.CustomEvent = FakeCustomEvent

await import('../client.js')
if (!mod || typeof mod.apply !== 'function') {
  console.error('FAIL client module did not export apply')
  process.exit(1)
}
mod.apply({ effect: (fn) => fn() })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(1500)

const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`) }

check('POST /speak 被调用', calls.speak.length >= 1, calls.speak[0] || '')
check('clip 段被播放', calls.audio.some((u) => u.includes('/muelsyse-voice/clip/CN_022')), calls.audio[0] || '')
check('事件命名空间正确', calls.events.some((e) => String(e.type).startsWith('muelsyse:voice:')),
  calls.events.map((e) => e.type).join(','))

const before = calls.audio.length
currentText = '把这段代码改一下'
if (observerCb) observerCb()
await sleep(1500)
check('技术句被请求', calls.speak.some((t) => t.includes('代码')), calls.speak[calls.speak.length - 1] || '')
check('技术句不播放', calls.audio.length === before, `${before} -> ${calls.audio.length}`)

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
process.exit(failed.length ? 1 : 0)
