/**
 * Muelsyse · voice — browser half, original-clip edition.
 *
 * Watches the transcript, asks the host for a semantic clip plan, and plays
 * exactly one clip per reply. Silent when the host has nothing confident; the
 * text stays on screen.
 *
 * 触发规则（这个文件里的门槛都是为它们服务的）：
 *   1. 首屏静默 — 页面刚起来、或整屏换了一批内容（换工作区 / 历史回填）时，
 *      屏幕上已有的正文只归档不念。
 *   2. 开屏静音 — `#muelsyse-opening` 还在 DOM 里时一律不出声（主题开屏动画）。
 *   3. 用户交互 — 只有用户点过/敲过之后新长出来的助手正文才可念；一条交互
 *      只出一条语音，之后同一条回复再怎么长高都不补。
 *   4. 去重 — 念过的正文摘要留在内存里，重放 / 重挂载 / 刷新都不重念。
 *   5. 首句先念 — 第一句一完整（出现句末标点）就走快速通道，不再等整段流式结束。
 *      快速通道只改「什么时候问宿主」，不改「播哪一条」：选片仍由宿主的语义计划决定。
 *      一条回复最多 FAST_SHOTS 次快速尝试，之后回落到常规防抖。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-muelsyse-voice',
  factory: (require) => {
    var BUTTON_ATTR = 'data-muelsyse-voice'
    var STORE_KEY = 'muelsyse-voice-v1'
    var SPEAK_URL = '/muelsyse-voice/speak'
    var THINK_URL = '/muelsyse-voice/thinking'
    var STATUS_URL = '/muelsyse-voice/status'
    var WARM_URL = '/muelsyse-voice/warm'

    var SHOW_BUTTON = false // 不要右下角悬浮按钮，直接自动念
    // 两级防抖。原来是单级 800ms 且「每次增长都重置」——流式每来一个字就把出声推后
    // 800ms，实际听感是「整段说完再干等 0.8 秒」。现在首句一完整就锁一个一次性的
    // 快速触发点，后续增长不再推迟它。
    var STABLE_MS = 450 // 拿不到完整首句时的常规防抖
    var FAST_QUIET_MS = 140 // 首句已完整：只等这么短的静默
    var FAST_SHOTS = 2 // 一条回复最多两次快速尝试（第 1 句、前 2 句），再往后回落常规防抖
    var POLL_MS = 400 // 容器兜底轮询：换工作区 / 面板重挂载时靠它重新挂 observer
    var BOOT_QUIET_MS = 2500 // 页面刚起来时的静默窗：首屏渲染期间一律不念
    var OPENING_ID = 'muelsyse-opening' // 主题开屏遮罩 id：它还在屏幕上就一定不念
    // 一次回复只播一条最贴切的切片。放宽容量的口径在 `window.__MUELSYSE_VOICE__`
    // 里写 { maxSegments: 2 }；多段正是「多播一句」的来源，默认不放开。
    var MAX_SEGMENTS = 1
    var REPLAY_REMOVED = 3 // 单个 mutation 批里拆掉这么多元素 → 判为换会话 / 重挂载
    // 单个 mutation 批里新增这么多正文块 → 判为历史回填。要明显高于「一条回复的
    // 段落数」，否则一段长回复一次性挂载时会被误判成历史而不出声。
    var REPLAY_ADDED = 8

    var state = { enabled: true, speaking: false, mode: 'clips', clips: 0 }
    var listeners = []
    var lastSpoken = ''
    var timer = null
    var audio = null
    var queue = []
    var playToken = 0
    var streamSources = [] // AudioBufferSourceNode 列表，停播时全部掐断
    var audioCtx = null

    // 触发链路的单回复状态。
    var fastTimer = null // 首句完整后的一次性快速定时器（不随后续增长重置）
    var fastShots = 0 // 本回复已经用掉的快速尝试次数
    var replyText = '' // 上次看到的正文：认「同一条回复还在长」还是「换了一条」
    var lastMutationAt = 0 // 最近一次正文变化的时间，只用于 latency 观测

    // 解码后的切片：url → AudioBuffer。预热过的切片直接出声，省掉 new Audio 的
    // 取回 + ogg 解码（16 个高频切片共 230KB，本机读一遍 0.5ms，主要开销在解码）。
    var clipBuffers = Object.create(null)
    var clipInflight = Object.create(null)
    var CLIP_BUFFER_MAX = 24
    // 本地意图预判（/warm 下发）。只用于提前解码候选切片，不参与选片。
    var warmIntents = null

    // 同一回复去重：playPlan 只播本回复还没播过的切片。
    // 键用 'id:CN_001' / 'url:…'，跨 /speak 请求（首句 + 余下）也生效。
    var playedKeys = Object.create(null)
    // 用户交互门：只有「用户先动过手」之后新长出来的正文才念；念出一条即复位。
    var armed = false
    var quietUntil = 0
    var observedTarget = null // 当前 observer 盯着的容器，被换掉就重挂
    // 已念过的正文摘要（只记最近 SPOKEN_MEMORY 条）：重放 / 重挂载时闭嘴。
    var spokenTexts = Object.create(null)
    var spokenOrder = []
    var SPOKEN_MEMORY = 32
    var APPLIED_KEY = typeof Symbol === 'function'
      ? Symbol.for('dsh.muelsyse.voice.applied')
      : '__dshMuelsyseVoiceApplied'

    // 客户端语音配置（可选）：`window.__MUELSYSE_VOICE__ = { maxSegments: 2 }`
    // 才放宽每次播报的段数，默认一段。
    var voiceCfg = (typeof window.__MUELSYSE_VOICE__ === 'object' && window.__MUELSYSE_VOICE__) || {}
    if (Number.isFinite(Number(voiceCfg.maxSegments))) {
      MAX_SEGMENTS = Math.max(1, Math.min(3, Math.trunc(Number(voiceCfg.maxSegments))))
    }

    // 思考分相：检测到思考块按相发声；声音走宿主清单，空清单只发事件不出声
    var thinkCfg = (typeof window.__MUELSYSE_THINKING__ === 'object' && window.__MUELSYSE_THINKING__) || {}
    var thinkSelectors = Array.isArray(thinkCfg.selectors)
      ? thinkCfg.selectors
      : ['[class*="thinking" i]', '[class*="reasoning" i]', '[class*="thought" i]']
    var thinkSounds = { start: [], mid: [], end: [] }
    var thinkIndex = { start: 0, mid: 0, end: 0 }
    var thinkActive = false
    var thinkMidCount = 0
    var thinkMidTimer = null
    var thinkAudio = null
    var thinkToken = 0

    function notify() {
      for (var i = 0; i < listeners.length; i += 1) {
        try {
          listeners[i](snapshot())
        } catch (error) {
          // A broken listener must not break the button.
        }
      }
      paint()
    }

    function snapshot() {
      return { enabled: state.enabled, speaking: state.speaking, mode: state.mode, clips: state.clips }
    }

    /** 没有记录时默认开启。 */
    function readStored() {
      try {
        var raw = window.localStorage.getItem(STORE_KEY)
        if (raw === null || raw === undefined) return true
        return raw === '1'
      } catch (error) {
        return true
      }
    }

    function store(enabled) {
      try {
        window.localStorage.setItem(STORE_KEY, enabled ? '1' : '0')
      } catch (error) {
        // Storage unavailable: session only.
      }
    }

    /** Strip markdown and code so the voice only sees prose. */
    function clean(text) {
      return String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^[#>\-*+\s]+/gm, '')
        .replace(/[*_~|]/g, '')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    function centerCol() {
      return document.querySelector('[class*="centerCol"]')
    }

    /** 新回复开始：本回复的已播记录清空。 */
    function resetReplyWindow() {
      playedKeys = Object.create(null)
    }

    /** 开屏动画期间一律静音：遮罩还在屏幕上，说明这页还没真正开始用。 */
    function openingOnScreen() {
      return document.getElementById(OPENING_ID) !== null
    }

    /** 正文摘要：同一条回复被重放时靠它认出来，免得再念一遍。 */
    function digest(text) {
      var source = String(text || '')
      var hash = 5381
      for (var index = 0; index < source.length; index += 1) {
        hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0
      }
      return (hash >>> 0).toString(36) + ':' + source.length
    }

    /** 记住这段正文已经念过，只保留最近 SPOKEN_MEMORY 条。 */
    function rememberSpoken(key) {
      if (spokenTexts[key]) return
      spokenTexts[key] = true
      spokenOrder.push(key)
      while (spokenOrder.length > SPOKEN_MEMORY) {
        delete spokenTexts[spokenOrder.shift()]
      }
    }

    /** 本回复已播的 clip id（发给宿主做跨请求去重）。 */
    function playedClipIds() {
      var out = []
      for (var key in playedKeys) {
        if (!Object.prototype.hasOwnProperty.call(playedKeys, key)) continue
        if (key.indexOf('id:') === 0) out.push(key.slice(3))
      }
      return out
    }

    /** 过滤掉本回复已播过的段：同一 reply 内一条 clip 只播一次。 */
    function novelSegments(segments) {
      var out = []
      for (var index = 0; index < segments.length; index += 1) {
        var item = segments[index]
        if (!item || typeof item !== 'object') continue
        var key = item.id ? 'id:' + String(item.id) : item.url ? 'url:' + String(item.url) : ''
        if (key !== '' && playedKeys[key]) continue
        if (key !== '') playedKeys[key] = true
        out.push(item)
      }
      return out
    }

    /** 这块正文是不是「助手说的话」：用户气泡、思考块、工具卡里的都不算。 */
    function assistantProse(node) {
      var parent = node
      for (var depth = 0; depth < 6 && parent !== null; depth += 1) {
        var className = String(parent.className || '')
        if (/user|bubble/i.test(className)) return false
        if (/(thinking|reasoning|thinkBody|toolCard|toolResult|compaction)/i.test(className)) return false
        parent = parent.parentElement
      }
      return true
    }

    /** The last assistant paragraph on screen, or an empty string. */
    function latestParagraph() {
      var transcript = centerCol()
      if (transcript === null) return ''
      var blocks = transcript.querySelectorAll('[class*="markdown"]')
      if (blocks.length === 0) return ''
      var node = null
      for (var cursor = blocks.length - 1; cursor >= 0; cursor -= 1) {
        if (assistantProse(blocks[cursor])) {
          node = blocks[cursor]
          break
        }
      }
      if (node === null) return ''
      var clone = node.cloneNode(true)
      var code = clone.querySelectorAll('pre, code')
      for (var index = 0; index < code.length; index += 1) code[index].remove()
      return clean(clone.textContent)
    }

    // 句末标点：与宿主 splitSentences 的口径对齐（… 在这里只当停顿，不参与切句）。
    var SENTENCE_END = /[。！？!?…；;\n]/

    /** 第 count 句结束处的正文前缀；完整句不够 count 句 → ''。 */
    function firstNSentences(text, count) {
      var source = String(text || '')
      var ends = 0
      for (var index = 0; index < source.length; index += 1) {
        if (!SENTENCE_END.test(source.charAt(index))) continue
        ends += 1
        if (ends >= count) return source.slice(0, index + 1).trim()
      }
      return ''
    }

    /** 同一条回复还在长（或重渲染变短）→ true；换成另一条正文 → false。 */
    function sameReply(prev, next) {
      if (prev === '' || next === '') return true
      return next.indexOf(prev) === 0 || prev.indexOf(next) === 0
    }

    /** 新正文只是旧正文的长高 → true。停播判定用这一条，比 sameReply 更严。 */
    function grewFrom(prev, next) {
      if (prev === '') return false
      return next.indexOf(prev) === 0
    }

    /** 归一化关键词：小写、只留中英日文与数字（宿主 normalizeText 的宽松版）。 */
    function normalizeKey(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^\u4e00-\u9fff\u3040-\u30ffA-Za-z0-9]/g, '')
    }

    /** 预热：取回 ogg 解码进 AudioBuffer；重复调用共享同一个 inflight。 */
    function warmClip(url) {
      var key = String(url || '')
      if (key === '') return null
      if (clipBuffers[key]) return null
      if (clipInflight[key]) return clipInflight[key]
      var ctx = ensureCtx()
      if (ctx === null) return null
      var request = fetch(key, { cache: 'force-cache' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.arrayBuffer()
        })
        .then(function (buffer) {
          return new Promise(function (resolve) {
            ctx.decodeAudioData(
              buffer,
              function (decoded) {
                resolve(decoded)
              },
              function () {
                resolve(null)
              },
            )
          })
        })
        .then(function (decoded) {
          delete clipInflight[key]
          if (!decoded) return null
          clipBuffers[key] = decoded
          var keys = Object.keys(clipBuffers)
          while (keys.length > CLIP_BUFFER_MAX) delete clipBuffers[keys.shift()]
          return decoded
        })
        .catch(function () {
          delete clipInflight[key]
          return null
        })
      clipInflight[key] = request
      return request
    }

    /**
     * /warm 下发：高频意图的触发词 + 默认切片 url。
     * 只做两件事——把默认切片解码好、用本地关键词预判下一个可能用到的意图。
     * 绝不参与选片：播哪一条永远以宿主 /speak 的语义计划为准。
     */
    function loadWarm() {
      fetch(WARM_URL, { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        })
        .then(function (data) {
          if (!data || !data.intents) return
          var table = {}
          for (var name in data.intents) {
            if (!Object.prototype.hasOwnProperty.call(data.intents, name)) continue
            var def = data.intents[name] || {}
            var words = []
            var list = Array.isArray(def.keywords) ? def.keywords : []
            for (var index = 0; index < list.length; index += 1) {
              var word = normalizeKey(list[index])
              if (word !== '') words.push(word)
            }
            var clips = Array.isArray(def.clips) ? def.clips : []
            table[name] = { keywords: words, priority: Number(def.priority) || 0, clips: clips }
            // 空闲时就把默认切片解码好：命中这个意图时不用再等解码。
            for (var at = 0; at < clips.length; at += 1) warmClip(clips[at])
          }
          warmIntents = table
        })
        .catch(function () {
          // 拿不到预热表就退回原来的按需加载，不影响发声。
        })
    }

    /** 本地轻量意图预判：只为预热，权重口径与宿主 classifyIntent 一致。 */
    function predictIntent(text) {
      if (!warmIntents) return null
      var clean = normalizeKey(text)
      if (clean === '') return null
      var best = null
      for (var name in warmIntents) {
        if (!Object.prototype.hasOwnProperty.call(warmIntents, name)) continue
        var entry = warmIntents[name]
        var score = 0
        for (var index = 0; index < entry.keywords.length; index += 1) {
          var word = entry.keywords[index]
          if (clean.indexOf(word) !== -1) score += 1 + 0.5 * (word.length - 1)
        }
        if (score <= 0) continue
        if (best === null || score > best.score + 1e-9 ||
            (Math.abs(score - best.score) <= 1e-9 && entry.priority > best.priority)) {
          best = { clips: entry.clips, score: score, priority: entry.priority }
        }
      }
      return best
    }

    /** 等 /speak 往返的时候，先把本地预判到的切片解码好（冷路径保险）。 */
    function predictWarm(text) {
      var guess = predictIntent(text)
      if (guess === null || !Array.isArray(guess.clips)) return
      for (var index = 0; index < guess.clips.length; index += 1) warmClip(guess.clips[index])
    }

    /** 全局 token：新序列 +1，旧的 onended 一看 token 不符就把队列丢掉。 */
    function stopAudio() {
      playToken += 1
      queue = []
      for (var index = 0; index < streamSources.length; index += 1) {
        try {
          streamSources[index].stop()
        } catch (error) {
          // already stopped
        }
      }
      streamSources = []
      if (audio !== null) {
        try {
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
        } catch (error) {
          // Already gone.
        }
        audio = null
      }
      if (state.speaking) {
        emitEvent('muelsyse:voice:speak-end', { reason: 'stop' })
        state.speaking = false
        notify()
      }
    }

    /** 思考分相：检测、事件、发声。正文出声时思考音让路，事件照发。 */
    function detectThinking() {
      var transcript = centerCol()
      if (transcript === null) return false
      for (var index = 0; index < thinkSelectors.length; index += 1) {
        try {
          var nodes = transcript.querySelectorAll(thinkSelectors[index])
          if (nodes && nodes.length > 0) return true
        } catch (error) {
          // 个别浏览器不支持 [attr i] 选择器，跳过该候选
        }
      }
      return false
    }

    /** 契约 v1 事件派发：见 EVENTS-SPEC.md，失败静默。 */
    function emitEvent(name, detail) {
      try {
        if (typeof window.CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
          var payload = detail || {}
          payload.v = 1
          if (payload.at === undefined) payload.at = Date.now()
          window.dispatchEvent(new window.CustomEvent(name, { detail: payload }))
        }
      } catch (error) {
        // 事件派发失败不影响发声
      }
    }

    function emitThinkPhase(phase) {
      emitEvent('muelsyse:voice:thinking-phase', { phase: phase })
    }

    function playThinkSound(phase) {
      var list = thinkSounds[phase]
      if (!Array.isArray(list) || list.length === 0) return
      if (openingOnScreen()) return // 开屏期间静音，事件照发
      if (state.speaking) return // 正文出声，思考音让路
      if (thinkAudio !== null) return
      var clip = list[thinkIndex[phase] % list.length]
      thinkIndex[phase] += 1
      var token = thinkToken
      var element = new Audio(clip.url)
      thinkAudio = element
      element.onended = function () {
        if (thinkToken === token) thinkAudio = null
      }
      element.onerror = element.onended
      element.play().catch(element.onended)
    }

    function stopThinkSounds() {
      thinkToken += 1
      if (thinkAudio !== null) {
        try {
          thinkAudio.pause()
          thinkAudio.removeAttribute('src')
          thinkAudio.load()
        } catch (error) {
          // already gone
        }
        thinkAudio = null
      }
    }

    function scheduleThinkMid() {
      if (thinkMidTimer !== null) clearTimeout(thinkMidTimer)
      var interval = Number(thinkCfg.midIntervalMs) || 8000
      var max = Number.isFinite(Number(thinkCfg.midMax)) ? Number(thinkCfg.midMax) : 2
      thinkMidTimer = setTimeout(function fire() {
        thinkMidTimer = null
        if (!thinkActive || !state.enabled) return
        emitThinkPhase('mid')
        if (thinkMidCount < max) playThinkSound('mid')
        thinkMidCount += 1
        if (thinkActive) thinkMidTimer = setTimeout(fire, interval)
      }, interval)
    }

    function thinkEnd() {
      thinkActive = false
      if (thinkMidTimer !== null) {
        clearTimeout(thinkMidTimer)
        thinkMidTimer = null
      }
      emitThinkPhase('end')
      playThinkSound('end')
    }

    function updateThink() {
      if (!state.enabled) {
        if (thinkActive) thinkEnd()
        return
      }
      var present = detectThinking()
      if (present && !thinkActive) {
        thinkActive = true
        thinkMidCount = 0
        emitThinkPhase('start')
        playThinkSound('start')
        scheduleThinkMid()
      } else if (!present && thinkActive) {
        thinkEnd()
      }
    }

    function loadThinkSounds() {
      fetch(THINK_URL, { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        })
        .then(function (data) {
          if (data && data.phases) {
            thinkSounds.start = Array.isArray(data.phases.start) ? data.phases.start : []
            thinkSounds.mid = Array.isArray(data.phases.mid) ? data.phases.mid : []
            thinkSounds.end = Array.isArray(data.phases.end) ? data.phases.end : []
          }
        })
        .catch(function () {
          // 清单缺失：思考音静默，分相事件照发
        })
    }

    /**
     * 一次回复只播一条：候选里挑分数最高的那段（同分取句子更靠前的），
     * 再按句序排回来。max 默认 1。
     */
    function bestSegments(fresh, max) {
      var ranked = []
      for (var index = 0; index < fresh.length; index += 1) {
        var item = fresh[index]
        var score = Number(item && item.score)
        ranked.push({ item: item, at: index, score: isFinite(score) ? score : 0 })
      }
      ranked.sort(function (left, right) {
        if (right.score !== left.score) return right.score - left.score
        return left.at - right.at
      })
      var keep = ranked.slice(0, Math.max(1, max))
      keep.sort(function (left, right) { return left.at - right.at })
      var out = []
      for (var pick = 0; pick < keep.length; pick += 1) out.push(keep[pick].item)
      return out
    }

    function isProse(node) {
      if (!/markdown/i.test(String(node.className || ''))) return false
      // 空的正文壳子不算：助手消息刚挂载时是个空 div，不能当历史回填。
      return clean(node.textContent) !== ''
    }

    function isUserRow(node) {
      return /(userRow|userStack|bubble)/i.test(String(node.className || ''))
    }

    /** 这批 mutation 是不是「整屏换了一批内容」：换会话 / 历史回填 / 重挂载。 */
    function isReplay(records) {
      if (!records || records.length === 0) return false
      var removed = 0
      var addedProse = 0
      var addedUsers = 0
      for (var index = 0; index < records.length; index += 1) {
        var record = records[index]
        var gone = record.removedNodes
        for (var g = 0; gone && g < gone.length; g += 1) {
          if (gone[g].nodeType === 1) removed += 1
        }
        var added = record.addedNodes
        for (var a = 0; added && a < added.length; a += 1) {
          var node = added[a]
          if (node.nodeType !== 1) continue
          if (isProse(node)) addedProse += 1
          if (isUserRow(node)) addedUsers += 1
          var inner = node.querySelectorAll('[class*="markdown"]')
          for (var p = 0; p < inner.length; p += 1) {
            if (isProse(inner[p])) addedProse += 1
          }
          addedUsers += node.querySelectorAll('[class*="userRow" i], [class*="bubble" i]').length
        }
      }
      if (removed >= REPLAY_REMOVED) return true
      if (addedProse >= REPLAY_ADDED) return true
      // 用户消息和正文在同一批里冒出来 → 是一次历史回放，不是新的一问一答。
      return addedUsers > 0 && addedProse > 0
    }

    /**
     * 把屏幕上现有的正文全部归档成「历史」：首屏、欢迎语、换工作区后的回放
     * 都不再触发语音。之后用户动手新长出来的那段才是可念的。
     */
    function markBaseline() {
      var transcript = centerCol()
      if (transcript !== null) {
        var blocks = transcript.querySelectorAll('[class*="markdown"]')
        for (var index = 0; index < blocks.length; index += 1) {
          var text = clean(blocks[index].textContent)
          if (text !== '') rememberSpoken(digest(text))
        }
      }
      armed = false
      quietUntil = Date.now() + BOOT_QUIET_MS
      if (fastTimer !== null) {
        clearTimeout(fastTimer)
        fastTimer = null
      }
      fastShots = 0
      replyText = ''
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    /** 用户点一下、敲一下，这一屏才算「他的」；开屏自动播放阶段永远不会 arm。 */
    function armOnGesture() {
      armed = true
      // 借这次真实手势把 AudioContext 建起来 / 唤醒：预热解码的切片才能直接出声。
      var ctx = ensureCtx()
      if (ctx !== null && ctx.state === 'suspended') {
        try {
          ctx.resume()
        } catch (error) {
          // 唤不醒就退回 HTMLAudio。
        }
      }
    }

    function listenGesture() {
      document.addEventListener('pointerdown', armOnGesture, true)
      document.addEventListener('keydown', armOnGesture, true)
      return function () {
        document.removeEventListener('pointerdown', armOnGesture, true)
        document.removeEventListener('keydown', armOnGesture, true)
      }
    }

    /** Play a mixed plan: clip 段走 HTML Audio，synth 段走流式 PCM/wav。 */
    function playPlan(segments, meta, onDone) {
      stopAudio()
      stopThinkSounds()
      // WebAudio 可能还停在 suspended：顺手 resume，解码好的切片才能直接排进播放。
      if (audioCtx !== null && audioCtx.state === 'suspended') {
        try {
          audioCtx.resume()
        } catch (error) {
          // resume 不了就退回 HTMLAudio，不影响出声。
        }
      }
      if (!state.enabled || !Array.isArray(segments) || segments.length === 0) return
      // 同一回复内一条 clip 只播一次：流式续写触发的第二次计划只播新段。
      var fresh = novelSegments(segments)
      if (fresh.length === 0) {
        state.mode = 'silent'
        notify()
        if (typeof onDone === 'function') onDone()
        return
      }
      // 一次回复只播一条：挑最贴切的那段，而不是按句序全念。
      var picked = bestSegments(fresh, MAX_SEGMENTS)
      playToken += 1
      var token = playToken
      queue = picked
      state.speaking = true
      state.mode = 'hybrid'
      notify()
      var index = 0
      var detail = {
        mode: (meta && meta.mode) || 'clips',
        count: queue.length,
        tts: meta && meta.tts,
      }
      // 观测口径：latencyMs = 发 /speak 到开口；sinceMutationMs = 最后一次正文变化到开口。
      if (meta && meta.triggerAt) detail.latencyMs = Date.now() - meta.triggerAt
      if (lastMutationAt > 0) detail.sinceMutationMs = Date.now() - lastMutationAt
      emitEvent('muelsyse:voice:speak-start', detail)

      function next() {
        if (token !== playToken || !state.enabled) {
          queue = []
          return
        }
        var item = queue.shift()
        if (item === undefined) {
          state.speaking = false
          emitEvent('muelsyse:voice:speak-end', { reason: 'done' })
          notify()
          if (typeof onDone === 'function') onDone()
          return
        }
        emitEvent('muelsyse:voice:segment-start', {
          index: index,
          type: item.type,
          id: item.id,
          url: item.url,
          text: item.text,
          duration: item.duration,
        })
        index += 1
        if (item.type === 'clip') {
          // onended / onerror / play().catch 三路兜底可能同时触发，只允许推进一次。
          var finished = false
          var advance = function () {
            if (finished) return
            finished = true
            if (token !== playToken) {
              queue = []
              state.speaking = false
              notify()
              return
            }
            next()
          }
          var cached = item.url ? clipBuffers[item.url] : null
          if (cached && audioCtx !== null && audioCtx.state === 'running') {
            // 预热命中：直接排 AudioBuffer，省掉取回 + 解码，这一段是零等待的。
            var source = audioCtx.createBufferSource()
            source.buffer = cached
            source.connect(audioCtx.destination)
            source.onended = advance
            source.start(audioCtx.currentTime + 0.01)
            streamSources.push(source)
            return
          }
          var element = new Audio(item.url)
          audio = element
          element.onended = advance
          element.onerror = advance
          element.play().catch(advance)
          // 没预热到就顺手解码：同一条切片下次就是零等待。
          if (item.url && !clipBuffers[item.url]) warmClip(item.url)
        } else {
          playSynth(token, item, index - 1, next)
        }
      }

      next()
    }

    /** 合成段：优先 raw PCM 流；失败（503 fallback）改播该句切片兜底。 */
    function playSynth(token, item, index, onDone) {
      // 合成段优先整句 wav：流式 PCM 在 32k 分片边界上会吞音；wav 走 decodeAudioData 更稳
      var synthUrl = String(item.url || '')
      synthUrl = synthUrl.replace('stream=1&', '').replace(/[?&]stream=1$/, '')
      fetch(synthUrl, { cache: 'no-store' })
        .then(function (response) {
          if (token !== playToken) {
            if (response.body && typeof response.body.cancel === 'function') response.body.cancel()
            onDone()
            return
          }
          if (!response.ok) {
            return response
              .json()
              .catch(function () {
                return null
              })
              .then(function (body) {
                if (token !== playToken) {
                  onDone()
                  return
                }
                if (body && body.fallback && Array.isArray(body.fallback.clips) && body.fallback.clips.length > 0) {
                  playFallbackClips(token, body.fallback.clips, index, onDone)
                } else {
                  onDone()
                }
              })
          }
          var type = String(response.headers.get('content-type') || '')
          if (type.indexOf('audio/L16') !== -1) {
            pumpPcm(token, response.body, onDone)
            return
          }
          return response.arrayBuffer().then(function (buffer) {
            if (token !== playToken) {
              onDone()
              return
            }
            playWavBuffer(token, buffer, onDone)
          })
        })
        .catch(function () {
          if (token === playToken) onDone()
        })
    }

    function playFallbackClips(token, clips, index, onDone) {
      var list = clips.slice()
      ;(function playOne() {
        if (token !== playToken || !state.enabled) {
          onDone()
          return
        }
        var clip = list.shift()
        if (clip === undefined) {
          onDone()
          return
        }
        emitEvent('muelsyse:voice:segment-start', {
          index: index,
          type: 'fallback',
          id: clip.id,
          url: clip.url,
          text: clip.text,
          duration: clip.duration,
        })
        var element = new Audio(clip.url)
        audio = element
        var finished = false
        var advance = function () {
          if (finished) return
          finished = true
          if (token === playToken) playOne()
        }
        element.onended = advance
        element.onerror = advance
        element.play().catch(advance)
      })()
    }

    function ensureCtx() {
      if (audioCtx === null) {
        var Ctx = window.AudioContext || window.webkitAudioContext
        if (!Ctx) return null
        audioCtx = new Ctx()
      }
      return audioCtx
    }

    /** int16 PCM（32k 单声道）按块排进 AudioContext，边收边播。 */
    function pumpPcm(token, body, onDone) {
      var ctx = ensureCtx()
      if (ctx === null) {
        try {
          body.cancel()
        } catch (error) {
          // ignore
        }
        onDone()
        return
      }
      if (ctx.state === 'suspended') {
        try {
          ctx.resume()
        } catch (error) {
          // ignore
        }
      }
      var reader = body.getReader()
      var nextTime = null

      function schedule(floats) {
        var sum = 0
        for (var j = 0; j < floats.length; j += 1) sum += floats[j] * floats[j]
        var rms = floats.length > 0 && sum > 0 ? 20 * Math.log10(Math.sqrt(sum / floats.length)) : -Infinity
        emitEvent('muelsyse:voice:level', { rms: rms })
        var buffer = ctx.createBuffer(1, floats.length, 32000)
        buffer.getChannelData(0).set(floats)
        var source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(ctx.destination)
        var start = nextTime === null ? ctx.currentTime + 0.02 : nextTime
        source.start(start)
        nextTime = start + buffer.duration
        streamSources.push(source)
      }

      function waitEnd() {
        var remaining = nextTime === null ? 0 : Math.max(nextTime - ctx.currentTime, 0)
        if (remaining <= 0.05) {
          if (token === playToken) onDone()
          return
        }
        setTimeout(function () {
          if (token === playToken) onDone()
        }, remaining * 1000 + 80)
      }

      function pump() {
        if (token !== playToken || !state.enabled) {
          try {
            reader.cancel()
          } catch (error) {
            // ignore
          }
          onDone()
          return
        }
        reader
          .read()
          .then(function (result) {
            if (token !== playToken || !state.enabled) {
              try {
                reader.cancel()
              } catch (error) {
                // ignore
              }
              onDone()
              return
            }
            if (result.done) {
              waitEnd()
              return
            }
            var bytes = result.value
            var samples = Math.floor(bytes.byteLength / 2)
            var view = new Int16Array(bytes.buffer, bytes.byteOffset, samples)
            var floats = new Float32Array(samples)
            for (var i = 0; i < samples; i += 1) floats[i] = view[i] / 32768
            schedule(floats)
            pump()
          })
          .catch(function () {
            waitEnd()
          })
      }

      pump()
    }

    function playWavBuffer(token, buffer, onDone) {
      var ctx = ensureCtx()
      if (ctx === null) {
        onDone()
        return
      }
      ctx.decodeAudioData(
        buffer,
        function (decoded) {
          if (token !== playToken) {
            onDone()
            return
          }
          var data = decoded.getChannelData(0)
          var sum = 0
          for (var j = 0; j < data.length; j += 1) sum += data[j] * data[j]
          var rms = data.length > 0 && sum > 0 ? 20 * Math.log10(Math.sqrt(sum / data.length)) : -Infinity
          emitEvent('muelsyse:voice:level', { rms: rms })
          var source = ctx.createBufferSource()
          source.buffer = decoded
          source.connect(ctx.destination)
          source.onended = function () {
            if (token === playToken) onDone()
          }
          source.start(ctx.currentTime + 0.02)
          streamSources.push(source)
        },
        function () {
          onDone()
        },
      )
    }

    /**
     * 一次 /speak 请求：带上本回复已播的 clip id（body.seen），
     * 宿主据此在跨请求（首句 + 余下）之间也避开重复切片。
     */
    function speakRequest(payload) {
      var body = { text: String(payload && payload.text ? payload.text : '') }
      if (payload && typeof payload.context === 'string' && payload.context !== '') {
        body.context = payload.context
      }
      if (payload && typeof payload.intent === 'string') body.intent = payload.intent
      var seen = playedClipIds()
      if (seen.length > 0) body.seen = seen
      return fetch(SPEAK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        })
    }

    /**
     * 兼容入口：旧的 /select 路由已经不存在，统一走 /speak 的语义计划。
     * payload.intent 时强制意图（语音开关的问候语），否则按文本分类。
     */
    function select(payload) {
      return speakRequest({
        text: payload && payload.text ? payload.text : '',
        intent: payload && typeof payload.intent === 'string' ? payload.intent : '',
      })
        .then(function (plan) {
          var segments = plan && Array.isArray(plan.segments) ? plan.segments : []
          if (segments.length === 0) {
            state.mode = 'silent'
            notify()
            return
          }
          playPlan(segments, { mode: plan.mode, tts: plan.tts })
        })
        .catch(function () {
          state.mode = 'error'
          notify()
        })
    }

    /**
     * 正文稳定后念一次。
     *
     * 四道门：开屏遮罩不在 / 过了首屏静默窗 / 用户先动过手 / 这段正文没念过。
     * 一条用户交互最多出一条语音；历史、欢迎语、工作区重放都不出声。
     *
     * candidate 由 schedule() 给：快速通道给「已完整的前 N 句」，常规通道给整段。
     */
    function speakStable(candidate) {
      if (!state.enabled) return
      if (openingOnScreen()) return
      if (Date.now() < quietUntil) {
        // 静默窗里冒出来的真实回复不该被永久吞掉：顺延到窗口结束再说。
        schedule()
        return
      }
      if (!armed) return
      var text = typeof candidate === 'string' && candidate !== '' ? candidate : latestParagraph()
      if (text === '' || text === lastSpoken) return
      var key = digest(text)
      if (spokenTexts[key]) return
      resetReplyWindow()
      lastSpoken = text
      rememberSpoken(key)
      var full = latestParagraph()
      if (full !== '' && full !== text) rememberSpoken(digest(full))
      // 先复位交互门：同一条回复后面再怎么长高都不补第二句。
      armed = false
      var cleanText = text.slice(0, 280)
      var triggerAt = Date.now()
      // 等 /speak 的这几毫秒里，先把本地预判到的切片解码好（命中就是零等待）。
      predictWarm(cleanText)
      speakRequest({ text: cleanText })
        .then(function (plan) {
          var segments = plan && Array.isArray(plan.segments) ? plan.segments : []
          if (segments.length === 0) {
            // 什么都没播：把门还回去，仍然只出一条。
            armed = true
            state.mode = 'silent'
            notify()
            // 首句没匹配上时，后面还有完整句就立刻排下一次尝试，不等下一次 DOM 变化。
            schedule()
            return
          }
          if (openingOnScreen()) return
          playPlan(segments, { mode: plan.mode, tts: plan.tts, triggerAt: triggerAt })
        })
        .catch(function () {
          // 请求失败和「没匹配上」一样把门还回去，别让这一条回复从此哑掉。
          armed = true
          state.mode = 'silent'
          notify()
        })
    }

    /** 排一次常规防抖（每次正文变化都重置）。 */
    function armStableTimer(delay) {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(function () {
        timer = null
        speakStable()
      }, Math.max(delay, 0))
    }

    /**
     * 什么时候问宿主：首句一完整就走一次性的快速通道（不被后续增长推迟），
     * 否则按常规防抖等正文停稳。首屏静默窗内一律顺延到窗口结束。
     */
    function schedule(knownText) {
      if (!state.enabled) return
      var now = Date.now()
      var text = typeof knownText === 'string' ? knownText : latestParagraph()

      // 单回复边界：正文换成另一条 → 重置本轮快速配额。
      if (text !== '' && replyText !== '' && !sameReply(replyText, text)) {
        if (fastTimer !== null) {
          clearTimeout(fastTimer)
          fastTimer = null
        }
        fastShots = 0
        resetReplyWindow()
        replyText = text
      } else if (text !== '') {
        replyText = text
      }

      // 首屏静默窗内：不排快速通道，统一顺延到窗口结束再判断。
      if (now < quietUntil) {
        if (fastTimer !== null) {
          clearTimeout(fastTimer)
          fastTimer = null
        }
        fastShots = 0
        armStableTimer(quietUntil - now)
        return
      }

      // 首句 / 前 N 句已完整：锁一个一次性快速触发点，之后正文再怎么长都不推迟它。
      if (fastTimer === null && fastShots < FAST_SHOTS && replyText !== '') {
        var head = firstNSentences(replyText, fastShots + 1)
        if (head !== '') {
          fastTimer = setTimeout(function () {
            fastTimer = null
            fastShots += 1
            speakStable(head)
          }, FAST_QUIET_MS)
          return
        }
      }

      // 快速通道在排着时，常规防抖这一轮不排，等它的结果再说。
      if (fastTimer !== null) return
      armStableTimer(STABLE_MS)
    }

    /** 新正文一出现就先闭嘴，再等它稳定下来念新的。 */
    function onMutate(records) {
      if (!state.enabled) return
      // 开屏动画期间一声不出：连待播的定时器也一并掐掉。
      if (openingOnScreen()) {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        if (fastTimer !== null) {
          clearTimeout(fastTimer)
          fastTimer = null
        }
        return
      }
      // 整屏换内容（换工作区 / 历史回填）：把现有正文归档，不追着念。
      if (isReplay(records)) {
        markBaseline()
        return
      }
      var text = latestParagraph()
      lastMutationAt = Date.now()
      // 只有「换成另一条正文」才闭嘴；同一条回复还在长时不能掐掉自己刚念的切片。
      if (state.speaking && text !== '' && !grewFrom(lastSpoken, text)) stopAudio()
      schedule(text)
      updateThink()
    }

    function attachObserver() {
      var target = centerCol()
      if (target === null) return null
      observedTarget = target
      var observer = new MutationObserver(function (records) {
        onMutate(records)
      })
      observer.observe(target, { childList: true, subtree: true, characterData: true })
      return observer
    }

    /** MutationObserver 为主，容器还没出来（或被换掉）时用 POLL_MS 轮询兜底。 */
    function watch() {
      var observer = attachObserver()
      // 首屏上已经有的正文（欢迎语、历史消息）一律归档，不念。
      markBaseline()
      var stopGesture = listenGesture()
      var pollId = setInterval(function () {
        var current = centerCol()
        // 容器被换掉（切工作区 / 面板重挂载）：换 observer，把新屏幕上的历史重新归档。
        if (current !== null && current !== observedTarget) {
          if (observer !== null) observer.disconnect()
          observer = attachObserver()
          markBaseline()
          return
        }
        if (observer !== null) return
        var found = attachObserver()
        if (found !== null) {
          observer = found
          markBaseline()
          clearInterval(pollId)
        }
      }, POLL_MS)
      return function () {
        if (observer !== null) observer.disconnect()
        if (stopGesture) stopGesture()
        clearInterval(pollId)
        if (timer !== null) clearTimeout(timer)
        if (fastTimer !== null) clearTimeout(fastTimer)
      }
    }

    /** Shared by the floating button and the Moonlit Cradle hub. */
    function setEnabled(enabled, announce) {
      state.enabled = !!enabled
      store(state.enabled)
      // 当前屏幕上的这段算「已经见过」：开关一次不该把同一条回复再念一遍。
      lastSpoken = latestParagraph()
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      notify()
      if (state.enabled && announce) {
        // 开启提示：走 /speak 的强制 greeting，不再是已经不存在的 /select。
        resetReplyWindow()
        select({ text: '语音已开启', intent: 'greeting' })
      } else if (!state.enabled) {
        stopAudio()
        stopThinkSounds()
      }
    }

    var button = null

    function paint() {
      if (button === null) return
      button.style.borderColor = state.enabled ? 'rgba(203,182,238,.62)' : 'rgba(203,182,238,.3)'
      button.style.color = state.speaking ? '#9fd8f5' : state.enabled ? '#e9eeff' : 'rgba(233,238,255,.6)'
      button.title = state.enabled
        ? '缪尔赛思语音' + (state.clips > 0 ? ' · ' + state.clips : '')
        : '缪尔赛思语音 · 关'
      button.setAttribute('data-speaking', state.speaking ? '1' : '0')
      var icon = button.querySelector('span')
      if (icon !== null) icon.textContent = state.speaking ? '◍' : '♪'
    }

    function mount() {
      if (!SHOW_BUTTON) {
        state.enabled = readStored()
        fetch(STATUS_URL, { cache: 'no-store' })
          .then(function (response) {
            return response.json()
          })
          .then(function (data) {
            state.mode = 'clips'
            state.clips = Number(data.clips) || 0
            notify()
          })
          .catch(function () {})
        loadThinkSounds()
        return function () {
          stopAudio()
          stopThinkSounds()
        }
      }
      if (document.querySelector('[' + BUTTON_ATTR + ']') !== null) return null
      button = document.createElement('button')
      button.type = 'button'
      button.setAttribute(BUTTON_ATTR, '')
      button.style.cssText =
        'position:fixed;right:18px;bottom:calc(134px + env(safe-area-inset-bottom));z-index:2147482000;' +
        'width:38px;height:38px;border-radius:999px;display:flex;align-items:center;justify-content:center;' +
        'border:1px solid rgba(203,182,238,.3);background:rgba(9,14,29,.94);color:rgba(233,238,255,.6);' +
        'cursor:pointer;box-shadow:0 10px 30px rgba(2,5,12,.45);transition:border-color .18s ease,color .18s ease'
      var icon = document.createElement('span')
      icon.textContent = '♪'
      icon.style.cssText = 'font-size:15px;line-height:1'
      button.appendChild(icon)
      button.addEventListener('click', function (event) {
        event.stopPropagation()
        setEnabled(!state.enabled, true)
      })
      document.documentElement.appendChild(button)
      state.enabled = readStored()
      fetch(STATUS_URL, { cache: 'no-store' })
        .then(function (response) {
          return response.json()
        })
        .then(function (data) {
          state.mode = 'clips'
          state.clips = Number(data.clips) || 0
          notify()
        })
        .catch(function () {})
      paint()
      loadThinkSounds()
      return function () {
        stopAudio()
        stopThinkSounds()
        button.remove()
      }
    }

    function apply(ctx) {
      // 单例：插件被重复加载/重复 apply 时，不再叠第二个 observer 和第二条朗读链。
      if (window[APPLIED_KEY]) return
      window[APPLIED_KEY] = true
      ctx.effect(
        function () {
          var onVoiceCommand = function (event) {
            var detail = event && event.detail ? event.detail : {}
            setEnabled(detail.enabled === true, true)
          }
          window.addEventListener('muelsyse:voice', onVoiceCommand)
          var disposeButton = mount()
          var disposeWatch = watch()
          // 预热表：高频意图的默认切片 + 触发词。失败就退回按需加载。
          loadWarm()
          return function () {
            window.removeEventListener('muelsyse:voice', onVoiceCommand)
            disposeWatch()
            if (typeof disposeButton === 'function') disposeButton()
            stopAudio()
            stopThinkSounds()
            resetReplyWindow()
            armed = false
            window[APPLIED_KEY] = false
          }
        },
        'muelsyse-voice: button and watcher',
      )
    }

    return { apply: apply }
  },
})
