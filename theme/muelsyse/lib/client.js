/**
 * Muelsyse · 生态科 — DeepSeek Harness theme plugin (browser half).
 *
 * Hand-written bundle in the client-modules format: executing this file only
 * *registers* a factory; the body runs when the kernel materializes the module
 * and mounts it as a Cordis plugin in the page.
 *
 * Responsibilities:
 *   1. attach the theme stylesheet (always version-stamped, so CSS edits land);
 *   2. hold the dark-palette attribute while mounted (the skin is dark-only);
 *   3. play the cinematic opening once per page session, with a skip affordance
 *      and a crossfade handoff into the main UI;
 *   4. mount the looped workshop background behind the workspace and ramp the
 *      BGM loop in so the handoff is a relay, not a cut;
 *   5. publish `window.__muelsyseDeck` and register the left-sidebar console
 *      (`sidebar.panellist` + its `main` page) inside this same package, so the
 *      theme no longer depends on the standalone dsh-plugin-muelsyse-hub.
 *
 * The heavy lifting stays in `theme/theme.css`, served by the host half. The
 * console's own styles are inline React style objects on purpose: this file
 * must not edit or depend on theme.css.
 */
window.__ModuleLoader__.load({
  id: 'dsh-theme-muelsyse',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var CSS_URL = '/theme-muelsyse/theme.css'
    var LOOP_VIDEO = '/theme-muelsyse/loop-2k60fps.mp4'
    var DARK_ATTRIBUTE = 'data-ds-dark-theme'
    var OPENING_ID = 'muelsyse-opening'
    var LOOP_ID = 'muelsyse-loop'
    var DECK_ID = 'muelsyse-deck'
    var OPENING_SEEN = 'muelsyse-opening-v1'
    var OPENING_PICK_KEY = 'muelsyse-opening-pick'
    var TRACK_PICK_KEY = 'muelsyse-bgm-pick'
    var MUTE_KEY = 'muelsyse-bgm-muted'
    var VOLUME_KEY = 'muelsyse-bgm-volume'
    var DEFAULT_VOLUME = 0.55

    var PANEL_ID = 'muelsyse'
    var PANEL_NS = 'muelsysePanel'
    var THEME_STATUS_URL = '/theme-muelsyse/status'
    var VOICE_STATUS_URL = '/muelsyse-voice/status'
    var VOICE_ENABLED_URL = '/muelsyse-voice/enabled'
    var PERSONA_STATUS_URL = '/muelsyse-persona/status'
    var PERSONA_ENABLED_URL = '/muelsyse-persona/enabled'
    // Autoplay is the voice plugin's own flag: the plugin owns it, keeps it in
    // localStorage, and listens for one window event. The panel drives it
    // through that event only, never through a host route.
    var VOICE_AUTOPLAY_KEY = 'muelsyse-voice-v1'
    var VOICE_EVENT = 'muelsyse:voice'

    /**
     * The four opening films. All four ship; one is the default and the deck
     * lets the person swap it. Each film has its own score, mixed at build
     * time, so a variant is a pair of files, never a guess.
     */
    var OPENINGS = [
      { id: 'A', title: '水月林间', film: '/theme-muelsyse/openings/A.mp4', score: '/theme-muelsyse/openings/score-A.m4a' },
      { id: 'B', title: '我在听哦', film: '/theme-muelsyse/openings/B.mp4', score: '/theme-muelsyse/openings/score-B.m4a' },
      { id: 'C', title: '万流归林', film: '/theme-muelsyse/openings/C.mp4', score: '/theme-muelsyse/openings/score-C.m4a' },
      { id: 'D', title: '归巢', film: '/theme-muelsyse/openings/D.mp4', score: '/theme-muelsyse/openings/score-D.m4a' },
    ]
    var OPENING_DEFAULT = 'B'

    function readPick(key) {
      try {
        return window.localStorage.getItem(key)
      } catch (error) {
        return null
      }
    }

    function writePick(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch (error) {
        // Private mode: the pick lasts for this page only.
      }
    }

    /** The opening this session should play: the stored pick, else the default. */
    function pickedOpening() {
      var pick = readPick(OPENING_PICK_KEY)
      for (var index = 0; index < OPENINGS.length; index += 1) {
        if (OPENINGS[index].id === pick) return OPENINGS[index]
      }
      for (var fallback = 0; fallback < OPENINGS.length; fallback += 1) {
        if (OPENINGS[fallback].id === OPENING_DEFAULT) return OPENINGS[fallback]
      }
      return OPENINGS[0]
    }

    function pickedTrack() {
      var pick = parseInt(readPick(TRACK_PICK_KEY) || '0', 10)
      if (isNaN(pick) || pick < 0 || pick >= PLAYLIST.length) return 0
      return pick
    }

    /** Attach the theme stylesheet; drop any stale copy first. */
    function ensureStylesheet() {
      var stale = document.querySelectorAll('link[href*="' + CSS_URL + '"]')
      for (var index = 0; index < stale.length; index += 1) stale[index].remove()
      var link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = CSS_URL + '?v=' + String(Date.now())
      link.setAttribute('data-muelsyse-css', '')
      document.head.appendChild(link)
      return function () { link.remove() }
    }

    /** Hold the dark palette attribute the theme's CSS is scoped to. */
    function holdDarkPalette() {
      var body = document.body
      if (body === null) return function () {}
      var hold = function () {
        if (!body.hasAttribute(DARK_ATTRIBUTE)) body.setAttribute(DARK_ATTRIBUTE, '')
      }
      hold()
      var observer = new MutationObserver(hold)
      observer.observe(body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] })
      var previousScheme = document.documentElement.style.colorScheme
      document.documentElement.style.colorScheme = 'dark'
      return function () {
        observer.disconnect()
        document.documentElement.style.colorScheme = previousScheme
      }
    }

    /** Report what the theme sees in the document, for `/theme-muelsyse/status`. */
    function reportFacts() {
      try {
        var facts = new URLSearchParams({
          dark: String(document.body.hasAttribute(DARK_ATTRIBUTE)),
          applied: String(getComputedStyle(document.body).getPropertyValue('--muelsyse-theme').trim() || '-'),
          link: String(document.querySelector('link[href*="/theme-muelsyse/"]') !== null),
          opening: String(document.getElementById(OPENING_ID) !== null),
          loop: String(document.getElementById(LOOP_ID) !== null),
        })
        fetch('/theme-muelsyse/report?' + facts.toString(), { cache: 'no-store' }).catch(function () {})
      } catch (error) {
        // A broken probe must not break the theme.
      }
    }

    /** The looped workshop background: fixed, behind the UI, never interactive. */
    function mountLoop() {
      if (document.getElementById(LOOP_ID) !== null) return
      var film = document.createElement('video')
      film.id = LOOP_ID
      film.muted = true
      film.loop = true
      film.autoplay = true
      film.playsInline = true
      film.setAttribute('preload', 'auto')
      film.setAttribute('aria-hidden', 'true')
      film.src = LOOP_VIDEO
      document.body.appendChild(film)
      var play = film.play()
      if (play && typeof play.catch === 'function') play.catch(function () {})
    }

    /**
     * The three sound-beds, played in order and then round again.
     *
     * All three are the PV material with the vocal stem taken out by demucs;
     * they are already loudness-matched, so the relay between them is a level
     * hold, not a jump.
     */
    var PLAYLIST = [
      { src: '/theme-muelsyse/bgm/01-eco-pv.m4a', label: '生态科 PV' },
      { src: '/theme-muelsyse/bgm/02-eco-showcase.m4a', label: '干员展示' },
      { src: '/theme-muelsyse/bgm/03-morning-dew.m4a', label: 'Morning Dew' },
    ]

    /** The live BGM element and its index; null until the first start. */
    var bgmAudio = null
    var bgmIndex = 0

    /** Deck listeners: the sidebar panel re-renders without polling the DOM. */
    var deckListeners = []

    /** The track the UI should show: live index once audio exists, else the pick. */
    function currentTrack() {
      return bgmAudio === null ? pickedTrack() : bgmIndex
    }

    function isPlaying() {
      return bgmAudio !== null && !bgmAudio.paused && !bgmAudio.muted
    }

    function isMuted() {
      return bgmAudio !== null ? bgmAudio.muted : readPick(MUTE_KEY) === '1'
    }

    /**
     * The bed's level as stored, clamped to 0..1.
     *
     * muelsyse-bgm-volume keeps the person's own level as a decimal string
     * ('0.55'), so a reload starts where the slider was left. An unparsable
     * value falls back to the default instead of to silence.
     */
    function storedVolume() {
      var raw = parseFloat(readPick(VOLUME_KEY))
      if (!isFinite(raw)) return DEFAULT_VOLUME
      return Math.min(1, Math.max(0, raw))
    }

    /** The live level: the element's own value once audio exists, else the pick. */
    function currentVolume() {
      return bgmAudio !== null ? bgmAudio.volume : storedVolume()
    }

    /**
     * Set the bed's level, 0..1, and remember it.
     *
     * Applies to the live element at once (the only ramp is the start-of-
     * session handoff), writes the pick, and notifies the panel so the slider
     * and the deck cannot drift apart. Returns the clamped value.
     */
    function setVolume(value) {
      var next = Number(value)
      if (!isFinite(next)) return currentVolume()
      next = Math.min(1, Math.max(0, next))
      writePick(VOLUME_KEY, String(next))
      if (bgmAudio !== null) bgmAudio.volume = next
      notifyDeck()
      return next
    }

    /** One snapshot for the panel and for the `muelsyse:deck` DOM event. */
    function deckSnapshot() {
      return {
        opening: pickedOpening().id,
        track: currentTrack(),
        playing: isPlaying(),
        muted: isMuted(),
        volume: currentVolume(),
        at: Date.now(),
      }
    }

    /** Tell the panel (and any other listener) that a deck value changed. */
    function notifyDeck() {
      var detail = deckSnapshot()
      try {
        window.dispatchEvent(new CustomEvent('muelsyse:deck', { detail: detail }))
      } catch (error) {
        // A host without CustomEvent still gets the in-page listeners below.
      }
      var listeners = deckListeners.slice()
      for (var index = 0; index < listeners.length; index += 1) {
        try {
          listeners[index](detail)
        } catch (error) {
          // One bad subscriber must not break the others.
        }
      }
    }

    /**
     * Swap the running bed for another track, from the top.
     *
     * `remember` defaults to true: both the deck and the panel persist the pick
     * to `muelsyse-bgm-pick`. The cross-tab `storage` mirror passes false so
     * echoing another tab's pick is not written back. The element keeps
     * `loop = true`, so whatever track is swapped in loops on its own.
     */
    function switchTrack(index, remember) {
      var next = Number(index)
      if (!isFinite(next) || next < 0 || next >= PLAYLIST.length) return false
      next = Math.floor(next)
      bgmIndex = next
      if (remember !== false) writePick(TRACK_PICK_KEY, String(next))
      if (bgmAudio !== null) {
        bgmAudio.src = PLAYLIST[next].src
        bgmAudio.volume = storedVolume()
        var played = bgmAudio.play()
        if (played && typeof played.catch === 'function') played.catch(function () {})
      }
      notifyDeck()
      return true
    }

    /** Mute/unmute the whole bed; the pick survives a reload. */
    function applyMuted(value) {
      var next = value === true
      writePick(MUTE_KEY, next ? '1' : '0')
      if (bgmAudio !== null) bgmAudio.muted = next
      notifyDeck()
      return next
    }

    /** Follow picks made in another tab or by the deck's own setters. */
    function watchStorage() {
      var onStorage = function (event) {
        if (event.key === TRACK_PICK_KEY) {
          var next = parseInt(event.newValue || '0', 10)
          if (!isNaN(next) && next >= 0 && next < PLAYLIST.length) switchTrack(next, false)
          return
        }
        if (event.key === MUTE_KEY) {
          applyMuted(event.newValue === '1')
          return
        }
        if (event.key === VOLUME_KEY) {
          var level = parseFloat(event.newValue)
          if (isFinite(level)) {
            if (bgmAudio !== null) bgmAudio.volume = Math.min(1, Math.max(0, level))
            notifyDeck()
          }
          return
        }
        if (event.key === OPENING_PICK_KEY) notifyDeck()
      }
      window.addEventListener('storage', onStorage)
      return function () { window.removeEventListener('storage', onStorage) }
    }

    /**
     * The BGM bed, ramped in so the handoff reads as a relay.
     *
     * Default is a single-track loop: `audio.loop` keeps the current track
     * replaying. Picking another track goes through `switchTrack`, which
     * swaps `src` on this same element while `loop` stays true, so the newly
     * picked track loops in turn.
     */
    function startBgm() {
      if (bgmAudio !== null) return bgmAudio
      var index = pickedTrack()
      bgmIndex = index
      // The person's own level, not a constant: the ramp climbs to it, so a
      // restored 0.2 is not blasted at 0.55 for a second on every reload.
      var level = storedVolume()
      var audio = new Audio()
      audio.loop = true
      audio.preload = 'auto'
      audio.volume = 0
      audio.muted = readPick(MUTE_KEY) === '1'
      audio.src = PLAYLIST[index].src
      bgmAudio = audio
      document.body.appendChild(audio)
      // No 'ended' listener on purpose: with loop = true the track restarts
      // itself, 'ended' never fires, and the old round-robin auto-advance is
      // gone. Manual switches go through switchTrack, which owns src + play.
      var started = false
      var attempt = function () {
        var p = audio.play()
        if (p && typeof p.then === 'function') {
          p.then(function () {
            started = true
            var t0 = performance.now()
            var tick = function () {
              var k = Math.min(1, (performance.now() - t0) / 1200)
              audio.volume = level * k
              if (k < 1) requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
            notifyDeck()
          }).catch(function () {
            // Autoplay blocked: wait for the next gesture.
            if (started) return
            var once = function () {
              document.removeEventListener('pointerdown', once)
              document.removeEventListener('keydown', once)
              attempt()
            }
            document.addEventListener('pointerdown', once)
            document.addEventListener('keydown', once)
          })
        }
      }
      attempt()
      return audio
    }

    /**
     * Play one opening film over the already-booted UI.
     *
     * Picture and score are separate files, both cut to the same length, so
     * they start together and cannot drift. The overlay is skippable at any
     * moment and always hands off to the BGM.
     */
    function playOpening(variant, force) {
      if (document.getElementById(OPENING_ID) !== null) return false
      var opening = variant || pickedOpening()
      var seen = false
      try { seen = window.sessionStorage.getItem(OPENING_SEEN) === '1' } catch (error) { seen = false }
      var forced = force === true || window.location.hash.indexOf('opening') !== -1
      if (seen && !forced) return false
      try { window.sessionStorage.setItem(OPENING_SEEN, '1') } catch (error) {}

      var overlay = document.createElement('div')
      overlay.id = OPENING_ID
      overlay.innerHTML =
        '<video class="mu-film" preload="auto" playsinline muted></video>' +
        '<div class="mu-film-tag">' + opening.id + ' · ' + opening.title + '</div>' +
        '<div class="mu-sound">♪ 点击启用声音</div>' +
        '<div class="mu-skip">点击 / Esc 跳过</div>'
      var film = overlay.querySelector('.mu-film')
      var score = new Audio()
      score.preload = 'auto'
      score.volume = 0
      score.src = opening.score
      film.src = opening.film
      document.body.appendChild(overlay)

      var done = false
      var teardown = function () {
        if (done) return
        done = true
        overlay.style.opacity = '0'
        try { score.pause() } catch (error) {}
        window.setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
        }, 320)
        startBgm()
        notifyDeck()
      }

      film.addEventListener('ended', teardown)
      film.addEventListener('error', teardown)

      var play = film.play()
      if (play && typeof play.catch === 'function') play.catch(teardown)

      // The score is best-effort: a blocked autoplay leaves a silent film and
      // offers the chip instead. Clicking the chip must not skip the film.
      var sound = overlay.querySelector('.mu-sound')
      var rampIn = function () {
        var t0 = performance.now()
        var tick = function () {
          if (done) return
          var k = Math.min(1, (performance.now() - t0) / 1100)
          score.volume = 0.9 * k
          if (k < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }
      var startScore = function () {
        var spin = score.play()
        if (spin && typeof spin.then === 'function') {
          spin.then(rampIn).catch(function () { sound.style.opacity = '1' })
        }
      }
      startScore()
      sound.addEventListener('click', function (event) {
        event.stopPropagation()
        sound.style.opacity = '0'
        startScore()
      })

      var skip = overlay.querySelector('.mu-skip')
      window.setTimeout(function () { skip.classList.add('is-visible') }, 2600)
      overlay.addEventListener('click', teardown)
      var onKey = function (event) {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          teardown()
        }
      }
      window.addEventListener('keydown', onKey)
      var release = function () { window.removeEventListener('keydown', onKey) }
      film.addEventListener('ended', release)
      return true
    }

    /**
     * Publish the handle the sidebar console and any other UI drive.
     *
     * Everything lives in this package now: the panel talks to this closure
     * through one small object on `window`, and both setters write the same
     * localStorage keys so a reload starts on the person's last pick.
     * Every setter returns the value it landed on, and `subscribe` fires on
     * every change (a track switch, a muted/unmuted switch), so the
     * panel and the main deck cannot drift apart.
     */
    function publishDeck() {
      var deck = {
        version: 1,
        openings: OPENINGS.map(function (item) {
          return { id: item.id, title: item.title }
        }),
        tracks: PLAYLIST.map(function (item, index) {
          return { index: index, label: item.label }
        }),
        opening: function () {
          return pickedOpening().id
        },
        track: function () {
          return currentTrack()
        },
        setOpening: function (id) {
          writePick(OPENING_PICK_KEY, String(id))
          var picked = pickedOpening()
          var live = document.getElementById(OPENING_ID)
          if (live !== null && live.parentNode) live.parentNode.removeChild(live)
          playOpening(picked, true)
          notifyDeck()
          return picked.id
        },
        setTrack: function (index) {
          switchTrack(index, true)
          return currentTrack()
        },
        playing: isPlaying,
        muted: isMuted,
        setMuted: applyMuted,
        volume: currentVolume,
        setVolume: setVolume,
        replay: function () {
          var played = playOpening(pickedOpening(), true)
          notifyDeck()
          return played
        },
        snapshot: deckSnapshot,
        subscribe: function (listener) {
          if (typeof listener !== 'function') return function () {}
          deckListeners.push(listener)
          return function () {
            var at = deckListeners.indexOf(listener)
            if (at !== -1) deckListeners.splice(at, 1)
          }
        },
      }
      window.__muelsyseDeck = deck
      return deck
    }

    // ---------------------------------------------------------------------
    // The left-sidebar console (formerly dsh-plugin-muelsyse-hub/client.js)
    // ---------------------------------------------------------------------

    var zh = {
      panel: '生态科',
      title: '缪尔赛思 · 生态科',
      subtitle: '开屏、声景与运行状态。选择会立即生效，并记到下一次打开。',
      'state.theme': '主题',
      'state.online': '在线',
      'state.offline': '未响应',
      'state.loading': '读取中…',
      'state.opening': '开屏遮罩',
      'state.bgm': '声景',
      'state.playing': '播放中',
      'state.waiting': '等待点击',
      'state.muted': '已静音',
      'state.selected': '已选中',
      'state.voice': '语音',
      'state.voiceOn': '可用',
      'state.voiceOff': '未启用',
      'state.envOnline': '环境在线',
      'state.envMissing': '环境缺失',
      'state.envChecking': '环境检测中',
      'env.hint': '环境缺失：先去网盘下载 SoVITS 环境包，再用 tools/start-sovits.ps1 启动。',
      'state.persona': '语气',
      'state.personaOn': '启用中',
      'state.personaOff': '未启用',
      'switches.title': '运行时开关',
      'switches.hint': '语音服务与语气各一个开关；自动念单独管播放。状态每三秒复核一次。',
      'switches.voice': '语音服务',
      'switches.persona': '语气',
      'switches.autoplay': '自动念',
      'switches.on': '在线',
      'switches.off': '关闭',
      'switches.autoplayOn': '开',
      'switches.autoplayOff': '关',
      'switches.voiceHint': '语音服务关掉后 /speak 与 /synth 静默或 503。',
      'switches.autoplayHint': '自动念只决定回复是否自动播放；它直接通知语音插件，不经过端口。',
      'switches.personaHint': '关掉后下一条回复恢复默认语气。',
      'volume.title': '音量',
      'volume.hint': '拖动即改声景音量，并记到下一次打开；与静音开关互不影响。',
      'volume.label': '声景音量',
      'state.reports': '探针',
      'openings.title': '开场',
      'openings.hint': '点一张就立刻重播它；下一次启动也用它。',
      'tracks.title': '声景',
      'tracks.hint': '点一首就当场换上，从这首的开头开始。',
      'deck.missing': '主题播放器未挂载：确认 dsh-theme-muelsyse 已启用。',
      'deck.replay': '重播开屏',
      'deck.muteOn': '音乐开着',
      'deck.muteOff': '音乐已关',
      'deck.muteHintOn': '点一下静音',
      'deck.muteHintOff': '点一下打开',
      'deck.note': '面板只调用主题自己的播放器，不修改 DSH 核心、配置或其他插件。',
      'error': '读取状态失败',
    }

    var en = {
      panel: 'Ecology',
      title: 'Muelsyse · Ecological Division',
      subtitle: 'Openings, sound beds and runtime status. Picks apply at once and are remembered.',
      'state.theme': 'theme',
      'state.online': 'online',
      'state.offline': 'silent',
      'state.loading': 'reading…',
      'state.opening': 'opening overlay',
      'state.bgm': 'sound bed',
      'state.playing': 'playing',
      'state.waiting': 'waiting for a click',
      'state.muted': 'muted',
      'state.selected': 'selected',
      'state.voice': 'voice',
      'state.voiceOn': 'available',
      'state.voiceOff': 'not mounted',
      'state.envOnline': 'env online',
      'state.envMissing': 'env missing',
      'state.envChecking': 'checking env',
      'env.hint': 'Env missing: download the SoVITS bundle from the shared drive, then start it with tools/start-sovits.ps1.',
      'state.persona': 'persona',
      'state.personaOn': 'active',
      'state.personaOff': 'not mounted',
      'switches.title': 'Runtime switches',
      'switches.hint': 'One switch each for the voice service and persona, plus autoplay for playback. A click applies at once; status is re-read every three seconds.',
      'switches.voice': 'voice service',
      'switches.persona': 'persona',
      'switches.autoplay': 'autoplay',
      'switches.on': 'online',
      'switches.off': 'off',
      'switches.autoplayOn': 'on',
      'switches.autoplayOff': 'off',
      'switches.voiceHint': 'When the voice service is off, /speak and /synth go silent or 503.',
      'switches.autoplayHint': 'Autoplay only decides whether a reply is read aloud; it signals the voice plugin directly, with no host route.',
      'switches.personaHint': 'When off, the next reply falls back to the default voice.',
      'volume.title': 'Volume',
      'volume.hint': 'Drag to set the bed level; it is remembered for the next launch and is independent of mute.',
      'volume.label': 'sound bed volume',
      'state.reports': 'probes',
      'openings.title': 'Openings',
      'openings.hint': 'Click one to replay it now; the next launch uses it too.',
      'tracks.title': 'Sound beds',
      'tracks.hint': 'Click one to switch now, from the top.',
      'deck.missing': 'Theme player not mounted: make sure dsh-theme-muelsyse is enabled.',
      'deck.replay': 'Replay opening',
      'deck.muteOn': 'Music on',
      'deck.muteOff': 'Music off',
      'deck.muteHintOn': 'Click to mute',
      'deck.muteHintOff': 'Click to unmute',
      'deck.note': 'This panel only drives the theme own player; it never edits DSH core, config or other plugins.',
      'error': 'Failed to read status',
    }

    // This node is injected straight into DSH's `main` slot, so it is the
    // outermost element of the page and has to own its own scrolling: the
    // shell does not scroll it. Without a height the column just grows past
    // the viewport, and the tail of the form — the volume slider, the
    // mute/replay row — ends up unreachable. `height: '100%'` + `overflowY:
    // 'auto'` keeps every control scrollable, and `boxSizing: 'border-box'`
    // keeps the padding inside that height. `flex`/`minHeight` cover the case
    // where the slot mount is a flex parent, since a percentage height there
    // would otherwise resolve against an auto-height box and scroll nothing.
    var pageStyle = {
      padding: '24px 26px 40px',
      maxWidth: '760px',
      margin: '0 auto',
      boxSizing: 'border-box',
      height: '100%',
      maxHeight: '100%',
      minHeight: 0,
      flex: '1 1 auto',
      overflowY: 'auto',
      overflowX: 'hidden',
      overscrollBehavior: 'contain',
      // theme.css styles `::-webkit-scrollbar-thumb` globally, but a pseudo
      // element cannot be reached from an inline style object; the standard
      // `scrollbar-color` gives the same 0.22 cyan thumb without touching CSS.
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(63, 214, 198, 0.22) transparent',
    }
    var headStyle = { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }
    var titleStyle = {
      margin: 0,
      fontSize: '21px',
      fontWeight: 600,
      letterSpacing: '.02em',
      color: 'var(--dsw-alias-label-primary)',
    }
    var subtitleStyle = {
      margin: '2px 0 16px',
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: '12.5px',
      lineHeight: 1.6,
    }
    var chipsStyle = { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }
    var chipStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '7px',
      padding: '3px 10px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      fontSize: '11.5px',
      color: 'var(--dsw-alias-label-secondary)',
    }
    var dotStyle = function (on) {
      return {
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)',
      }
    }
    var sectionStyle = {
      background: 'var(--dsw-alias-bg-layer-1)',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: '14px',
      padding: '16px 18px',
      marginBottom: '14px',
    }
    var sectionTitleStyle = {
      margin: '0 0 4px',
      fontSize: '12px',
      fontWeight: 600,
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: 'var(--dsw-alias-label-tertiary)',
    }
    var hintStyle = {
      margin: '0 0 12px',
      fontSize: '12px',
      lineHeight: 1.7,
      color: 'var(--dsw-alias-label-tertiary)',
    }
    var gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '9px' }
    var tileStyle = function (active) {
      return {
        appearance: 'none',
        textAlign: 'left',
        border: '1px solid ' + (active ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'),
        background: active ? 'var(--dsw-alias-bg-layer-3)' : 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: '10px',
        padding: '10px 12px',
        font: 'inherit',
        cursor: 'pointer',
        transition: 'border-color .18s ease, background .18s ease',
      }
    }
    var tileKeyStyle = {
      display: 'block',
      fontSize: '10.5px',
      letterSpacing: '.18em',
      color: 'var(--dsw-alias-label-tertiary)',
      marginBottom: '5px',
    }
    var tileNameStyle = { display: 'block', fontSize: '14px', fontWeight: 600 }
    var tileMetaStyle = {
      display: 'block',
      marginTop: '3px',
      fontSize: '11px',
      color: 'var(--dsw-alias-label-tertiary)',
    }
    var buttonStyle = {
      appearance: 'none',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      borderRadius: '8px',
      padding: '8px 14px',
      fontSize: '12.5px',
      fontFamily: 'inherit',
      cursor: 'pointer',
    }
    var noteStyle = {
      margin: '12px 0 0',
      fontSize: '11.5px',
      lineHeight: 1.7,
      color: 'var(--dsw-alias-label-tertiary)',
    }
    // Sits right under the chip row, so the hint reads as the env chip's footnote.
    var envHintStyle = {
      margin: '-6px 0 14px',
      fontSize: '11.5px',
      lineHeight: 1.7,
      color: 'var(--dsw-alias-label-tertiary)',
    }
    var actionsStyle = { display: 'flex', flexWrap: 'wrap', gap: '9px' }
    var toggleStyle = function (active, disabled) {
      return {
        appearance: 'none',
        border: '1px solid ' + (active
          ? 'var(--dsw-alias-state-success-primary)'
          : 'var(--dsw-alias-border-l2)'),
        background: active ? 'var(--dsw-alias-bg-layer-3)' : 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: '8px',
        padding: '7px 13px',
        font: 'inherit',
        fontSize: '12.5px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }
    }
    var sliderRowStyle = { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }
    var sliderStyle = {
      appearance: 'none',
      flex: '1 1 auto',
      height: '4px',
      borderRadius: '999px',
      background: 'var(--dsw-alias-border-l2)',
      accentColor: 'var(--dsw-alias-state-success-primary)',
      cursor: 'pointer',
    }
    var sliderValueStyle = {
      minWidth: '38px',
      textAlign: 'right',
      fontSize: '11.5px',
      fontVariantNumeric: 'tabular-nums',
      color: 'var(--dsw-alias-label-tertiary)',
    }

    /** The theme's mark: a drop over three reeds. */
    function MarshMark(props) {
      var React = require('react')
      var h = React.createElement
      var size = props && props.size ? props.size : 18
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('path', {
          d: 'M12 3.2c2.6 3.1 4.2 5.3 4.2 7.4a4.2 4.2 0 1 1-8.4 0c0-2.1 1.6-4.3 4.2-7.4Z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M5 20.4c1.8-1.2 3.4-1.2 5.2 0s3.4 1.2 5.2 0 3.4-1.2 3.6 0',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    function readDeck() {
      var deck = typeof window !== 'undefined' ? window.__muelsyseDeck : undefined
      return deck && typeof deck.setOpening === 'function' ? deck : null
    }

    /** The voice plugin records autoplay itself; absent or '1' reads as on. */
    function readAutoplay() {
      try {
        return window.localStorage.getItem(VOICE_AUTOPLAY_KEY) !== '0'
      } catch (error) {
        return true
      }
    }

    function fetchJson(url) {
      return fetch(url, { cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
    }

    /** POST a tiny JSON body and read the JSON answer; rejects on non-2xx. */
    function postJson(url, body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(body),
      }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
    }

    /** Ask the host halves what they see; both routes are read-only probes. */
    function useStatuses() {
      var React = require('react')
      var theme = React.useState({ loading: true, data: null, error: null })
      var voice = React.useState({ loading: true, data: null, error: null })
      var persona = React.useState({ loading: true, data: null, error: null })
      React.useEffect(function () {
        var alive = true
        var load = function () {
          fetchJson(THEME_STATUS_URL)
            .then(function (data) {
              if (alive) theme[1]({ loading: false, data: data, error: null })
            })
            .catch(function (error) {
              if (alive) theme[1]({ loading: false, data: null, error: error })
            })
          fetchJson(VOICE_STATUS_URL)
            .then(function (data) {
              if (alive) voice[1]({ loading: false, data: data, error: null })
            })
            .catch(function (error) {
              if (alive) voice[1]({ loading: false, data: null, error: error })
            })
          fetchJson(PERSONA_STATUS_URL)
            .then(function (data) {
              if (alive) persona[1]({ loading: false, data: data, error: null })
            })
            .catch(function (error) {
              if (alive) persona[1]({ loading: false, data: null, error: error })
            })
        }
        load()
        var timer = setInterval(load, 3000)
        return function () {
          alive = false
          clearInterval(timer)
        }
      }, [])
      return [theme[0], voice[0], persona[0]]
    }

    /** Bound in `registerPanel`; also works if the slot does not pass `t` as a prop. */
    var panelT = null

    function PanelPage(props) {
      var React = require('react')
      var h = React.createElement
      var t = props && typeof props.t === 'function' ? props.t : panelT !== null ? panelT : function (key) { return key }
      var tickState = React.useState(0)
      var setTick = tickState[1]
      var statuses = useStatuses()
      var themeStatus = statuses[0]
      var voiceStatus = statuses[1]
      var personaStatus = statuses[2]
      // Local override: a POST answer lands before the next poll, so the tile
      // flips on the click instead of up to three seconds later.
      var overrideState = React.useState({ voice: null, persona: null })
      var overrides = overrideState[0]
      var setOverride = overrideState[1]
      // Autoplay has no host switch: the voice plugin owns the flag and reads
      // it from localStorage, so this button mirrors that key and nudges the
      // plugin with one event.
      var autoplayState = React.useState(readAutoplay)
      var autoplay = autoplayState[0]
      var setAutoplay = autoplayState[1]

      React.useEffect(function () {
        var timer = setInterval(function () {
          setTick(function (n) { return n + 1 })
        }, 1000)
        return function () { clearInterval(timer) }
      }, [])

      React.useEffect(function () {
        var deck = readDeck()
        if (deck === null || typeof deck.subscribe !== 'function') return
        return deck.subscribe(function () {
          setTick(function (n) { return n + 1 })
        })
      }, [])

      // The plugin may flip its own flag outside this page; the one-second
      // tick is a cheap place to re-read it, and it also confirms our click.
      React.useEffect(function () {
        setAutoplay(readAutoplay())
      }, [tickState[0]])

      var deck = readDeck()
      var opening = deck ? deck.opening() : null
      var track = deck ? deck.track() : null
      var playing = deck ? deck.playing() : false
      var muted = deck && typeof deck.muted === 'function' ? deck.muted() : false
      var online = themeStatus.data !== null && themeStatus.error === null
      var voiceOn = voiceStatus.data !== null && voiceStatus.error === null
      var reports = themeStatus.data ? themeStatus.data.reportCount : 0
      var overlay = typeof document !== 'undefined' && document.getElementById(OPENING_ID) !== null
      var voiceClips = voiceOn && voiceStatus.data ? voiceStatus.data.clips : 0
      var personaOn = personaStatus.data !== null && personaStatus.error === null
      // /status 带的是宿主那次探测的快照；老宿主没有 env 字段 → 显示「检测中」，
      // 不猜成在线。voiceOn 为假时连状态都读不到，同样按缺失处理。
      var env = voiceOn && voiceStatus.data && voiceStatus.data.env ? voiceStatus.data.env : null
      var envOnline = env !== null && env.serverOnline === true
      var envMissing = voiceOn && env !== null && envOnline === false
      // /status stays readable while a switch is off, so `enabled` is the
      // truth; a host without the field reads as on.
      var voiceEnabled = voiceOn
        ? (overrides.voice !== null ? overrides.voice : voiceStatus.data.enabled !== false)
        : false
      var personaEnabled = personaOn
        ? (overrides.persona !== null ? overrides.persona : personaStatus.data.enabled !== false)
        : false
      var volume = deck && typeof deck.volume === 'function' ? deck.volume() : 0.55

      var pick = function (id) {
        if (deck) deck.setOpening(id)
        setTick(function (n) { return n + 1 })
      }
      var pickTrack = function (index) {
        if (deck) deck.setTrack(index)
        setTick(function (n) { return n + 1 })
      }
      var toggleVoice = function () {
        if (!voiceOn) return
        var next = !voiceEnabled
        postJson(VOICE_ENABLED_URL, { enabled: next })
          .then(function (data) {
            setOverride(function (current) {
              return { voice: data.enabled !== false, persona: current.persona }
            })
            setTick(function (n) { return n + 1 })
          })
          .catch(function () {
            setOverride(function (current) { return { voice: null, persona: current.persona } })
            setTick(function (n) { return n + 1 })
          })
      }
      var toggleAutoplay = function () {
        var next = !autoplay
        setAutoplay(next)
        try {
          window.dispatchEvent(new window.CustomEvent(VOICE_EVENT, { detail: { enabled: next } }))
        } catch (error) {
          // No CustomEvent: the read-back below still shows the stored value.
        }
        // The plugin writes the flag when it handles the event; reading it
        // back keeps the button honest even if no plugin is mounted.
        window.setTimeout(function () { setAutoplay(readAutoplay()) }, 80)
      }
      var togglePersona = function () {
        if (!personaOn) return
        var next = !personaEnabled
        postJson(PERSONA_ENABLED_URL, { enabled: next })
          .then(function (data) {
            setOverride(function (current) {
              return { voice: current.voice, persona: data.enabled !== false }
            })
            setTick(function (n) { return n + 1 })
          })
          .catch(function () {
            setOverride(function (current) { return { voice: current.voice, persona: null } })
            setTick(function (n) { return n + 1 })
          })
      }
      var changeVolume = function (value) {
        if (deck && typeof deck.setVolume === 'function') {
          deck.setVolume(Number(value) / 100)
        }
        setTick(function (n) { return n + 1 })
      }

      var openingCards = deck
        ? deck.openings.map(function (item) {
            var active = item.id === opening
            return h(
              'button',
              {
                key: item.id,
                type: 'button',
                style: tileStyle(active),
                onClick: function () { pick(item.id) },
              },
              h('span', { style: tileKeyStyle }, item.id),
              h('span', { style: tileNameStyle }, item.title),
              h('span', { style: tileMetaStyle }, active ? '● ' + t('state.selected') : ' '),
            )
          })
        : []

      var trackRows = deck
        ? deck.tracks.map(function (item) {
            var active = item.index === track
            return h(
              'button',
              {
                key: item.index,
                type: 'button',
                style: tileStyle(active),
                onClick: function () { pickTrack(item.index) },
              },
              h('span', { style: tileKeyStyle }, ('0' + (item.index + 1)).slice(-2)),
              h('span', { style: tileNameStyle }, item.label),
              h(
                'span',
                { style: tileMetaStyle },
                active ? '● ' + (playing ? t('state.playing') : muted ? t('state.muted') : t('state.selected')) : ' ',
              ),
            )
          })
        : []

      return h(
        'div',
        { style: pageStyle },
        h(
          'div',
          { style: headStyle },
          h(MarshMark, { size: 30 }),
          h('h1', { style: titleStyle }, t('title')),
        ),
        h('p', { style: subtitleStyle }, t('subtitle')),
        h(
          'div',
          { style: chipsStyle },
          h(
            'span',
            { style: chipStyle },
            h('span', { style: dotStyle(online) }),
            t('state.theme') + ' · ' + (online ? t('state.online') : themeStatus.loading ? t('state.loading') : t('state.offline')),
          ),
          h('span', { style: chipStyle }, t('state.opening') + ' · ' + (overlay ? '●' : '—')),
          h(
            'span',
            { style: chipStyle },
            t('state.bgm') + ' · ' + (muted ? t('state.muted') : playing ? t('state.playing') : t('state.waiting')),
          ),
          h(
            'span',
            { style: chipStyle },
            h('span', { style: dotStyle(voiceOn) }),
            t('state.voice') + ' · ' + (voiceOn ? t('state.voiceOn') + ' ' + voiceClips : t('state.voiceOff')),
          ),
          h(
            'span',
            { style: chipStyle, title: env !== null && env.apiUrl ? env.apiUrl : undefined },
            h('span', { style: dotStyle(envOnline) }),
            !voiceOn
              ? t('state.envMissing')
              : env === null
                ? t('state.envChecking')
                : envOnline
                  ? t('state.envOnline')
                  : t('state.envMissing'),
          ),
          h(
            'span',
            { style: chipStyle },
            h('span', { style: dotStyle(personaOn) }),
            t('state.persona') + ' · ' + (personaOn ? t('state.personaOn') : t('state.personaOff')),
          ),
          h('span', { style: chipStyle }, t('state.reports') + ' ' + reports),
        ),
        envMissing ? h('p', { style: envHintStyle }, t('env.hint')) : null,
        h(
          'section',
          { style: sectionStyle },
          h('h2', { style: sectionTitleStyle }, t('openings.title')),
          h('p', { style: hintStyle }, deck ? t('openings.hint') : t('deck.missing')),
          h('div', { style: gridStyle }, openingCards),
        ),
        h(
          'section',
          { style: sectionStyle },
          h('h2', { style: sectionTitleStyle }, t('tracks.title')),
          h('p', { style: hintStyle }, deck ? t('tracks.hint') : t('deck.missing')),
          h('div', { style: gridStyle }, trackRows),
        ),
        h(
          'section',
          { style: sectionStyle },
          h('h2', { style: sectionTitleStyle }, t('switches.title')),
          h('p', { style: hintStyle }, t('switches.hint')),
          h(
            'div',
            { style: actionsStyle },
            h(
              'button',
              {
                type: 'button',
                style: toggleStyle(voiceEnabled, !voiceOn),
                disabled: !voiceOn,
                onClick: toggleVoice,
              },
              t('switches.voice') + ' · ' + (voiceEnabled ? t('switches.on') : t('switches.off')),
            ),
            h(
              'button',
              {
                type: 'button',
                style: toggleStyle(autoplay, false),
                onClick: toggleAutoplay,
              },
              t('switches.autoplay') + ' · ' + (autoplay ? t('switches.autoplayOn') : t('switches.autoplayOff')),
            ),
            h(
              'button',
              {
                type: 'button',
                style: toggleStyle(personaEnabled, !personaOn),
                disabled: !personaOn,
                onClick: togglePersona,
              },
              t('switches.persona') + ' · ' + (personaEnabled ? t('switches.on') : t('switches.off')),
            ),
          ),
          h('p', { style: noteStyle }, t('switches.voiceHint') + ' ' + t('switches.autoplayHint') + ' ' + t('switches.personaHint')),
        ),
        h(
          'section',
          { style: sectionStyle },
          h('h2', { style: sectionTitleStyle }, t('volume.title')),
          h('p', { style: hintStyle }, t('volume.hint')),
          h(
            'div',
            { style: sliderRowStyle },
            h('input', {
              type: 'range',
              min: 0,
              max: 100,
              step: 1,
              value: Math.round(volume * 100),
              disabled: deck === null,
              'aria-label': t('volume.label'),
              style: sliderStyle,
              onChange: function (event) { changeVolume(event.target.value) },
            }),
            h('span', { style: sliderValueStyle }, Math.round(volume * 100) + '%'),
          ),
          h(
            'div',
            { style: actionsStyle },
            h(
              'button',
              {
                type: 'button',
                style: buttonStyle,
                disabled: deck === null,
                onClick: function () { if (deck) deck.setMuted(!muted) },
              },
              muted ? t('deck.muteOff') + ' · ' + t('deck.muteHintOff') : t('deck.muteOn') + ' · ' + t('deck.muteHintOn'),
            ),
            h(
              'button',
              {
                type: 'button',
                style: buttonStyle,
                disabled: deck === null,
                onClick: function () { if (deck) deck.replay() },
              },
              t('deck.replay'),
            ),
          ),
          h('p', { style: noteStyle }, t('deck.note')),
        ),
      )
    }

    /** Register the sidebar row and its page through the host's own slots. */
    function registerPanel(ctx) {
      ctx.effect(
        function () {
          return ctx.locale.register(PANEL_NS, { zh: zh, en: en })
        },
        'theme-muelsyse: panel dictionaries',
      )
      var t = ctx.locale.bind(PANEL_NS)
      panelT = t

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 16,
            label: function () { return t('panel') },
            locale: PANEL_NS,
          },
          MarshMark,
        )
      })

      ctx.slots.inject('main', function* () {
        yield ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: PANEL_NS,
            inject: function () {
              return { t: t }
            },
          },
          PanelPage,
        )
      })
    }

    /** Mount everything on the page. */
    function mount() {
      var disposers = []
      try {
        disposers.push(ensureStylesheet())
        disposers.push(holdDarkPalette())
        mountLoop()
        publishDeck()
        disposers.push(watchStorage())
        var played = playOpening(null, false)
        if (!played) startBgm()
        reportFacts()
      } catch (error) {
        // A skin must never be the reason the app cannot be used. If any of
        // this throws, the shell keeps its stock look and the error is logged.
        try {
          console.error('[muelsyse] mount failed', error)
        } catch (ignored) {
          // No console: nothing else to do.
        }
      }
      return function () {
        for (var index = 0; index < disposers.length; index += 1) {
          try {
            disposers[index]()
          } catch (error) {
            // Unmount is best-effort too.
          }
        }
        deckListeners.length = 0
        if (bgmAudio !== null) {
          try { bgmAudio.pause() } catch (error) {}
          if (bgmAudio.parentNode) bgmAudio.parentNode.removeChild(bgmAudio)
          bgmAudio = null
        }
        if (window.__muelsyseDeck !== undefined) delete window.__muelsyseDeck
      }
    }

    /**
     * The theme owns both halves now: mount the skin first, then register the
     * console in the same Cordis plugin. A slot failure must not take the skin
     * down, so the registration is guarded separately.
     */
    function apply(ctx) {
      var disposeTheme = mount()
      try {
        registerPanel(ctx)
      } catch (error) {
        try {
          console.error('[muelsyse] panel registration failed', error)
        } catch (ignored) {}
      }
      return disposeTheme
    }

    module.exports = { inject: ['slots', 'locale'], apply: apply }
    return module.exports
  },
})
