/**
 * Muelsyse · 生态科 — the left-sidebar console for the DSH theme.
 *
 * The page drives the theme through `window.__muelsyseDeck` (published by
 * dsh-theme-muelsyse): pick one of four openings, pick one of three sound
 * beds, replay the opening. It writes nothing except the same two
 * localStorage keys the theme itself uses, and it never touches the DOM
 * outside its own React subtree.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-muelsyse-hub',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'muelsyseHub'
    const PANEL_ID = 'muelsyse'
    const STATUS_URL = '/theme-muelsyse/status'
    const HUB_URL = '/muelsyse-hub/ping'

    const zh = {
      panel: '生态科',
      title: '缪尔赛思 · 生态科',
      subtitle: '开屏、声景与运行状态。选择会立即生效，并记到下一次打开。',
      'state.online': '主题在线',
      'state.offline': '主题未响应',
      'state.loading': '读取中…',
      'state.opening': '开屏遮罩',
      'state.player': '播放器',
      'state.playing': '播放中',
      'state.waiting': '等待点击',
      'openings.title': '开场',
      'openings.hint': '点一张就立刻重播它；下一次启动也用它。',
      'tracks.title': '声景',
      'tracks.hint': '点一首就当场换上，从这首的开头开始。',
      'deck.missing': '主题播放器未挂载：确认 dsh-theme-muelsyse 已启用。',
      'deck.replay': '重播开屏',
      'deck.note': '这个入口只调用主题自己的播放器，不修改 DSH 核心、配置或其他插件。',
      'error': '读取状态失败',
    }

    const en = {
      panel: 'Ecology',
      title: 'Muelsyse · Ecological Division',
      subtitle: 'Openings, sound beds and runtime status. Picks apply at once and are remembered.',
      'state.online': 'theme online',
      'state.offline': 'theme silent',
      'state.loading': 'reading…',
      'state.opening': 'opening overlay',
      'state.player': 'player',
      'state.playing': 'playing',
      'state.waiting': 'waiting for a click',
      'openings.title': 'Openings',
      'openings.hint': 'Click one to replay it now; the next launch uses it too.',
      'tracks.title': 'Sound beds',
      'tracks.hint': 'Click one to switch now, from the top.',
      'deck.missing': 'Theme player not mounted: make sure dsh-theme-muelsyse is enabled.',
      'deck.replay': 'Replay opening',
      'deck.note': 'This page only drives the theme own player; it never edits DSH core, config or other plugins.',
      'error': 'Failed to read status',
    }

    const page = {
      padding: '28px 32px 48px',
      maxWidth: '980px',
      margin: '0 auto',
      boxSizing: 'border-box',
    }
    const title = {
      margin: 0,
      fontSize: '22px',
      fontWeight: 600,
      letterSpacing: '.02em',
      color: 'var(--dsw-alias-label-primary)',
    }
    const subtitle = {
      margin: '6px 0 18px',
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: '13px',
      lineHeight: 1.6,
    }
    const chips = { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }
    const chip = {
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
    const dot = (on) => ({
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)',
    })
    const section = {
      background: 'var(--dsw-alias-bg-layer-1)',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: '14px',
      padding: '18px 20px',
      marginBottom: '16px',
    }
    const sectionTitle = {
      margin: '0 0 4px',
      fontSize: '12px',
      fontWeight: 600,
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: 'var(--dsw-alias-label-tertiary)',
    }
    const hint = { margin: '0 0 14px', fontSize: '12px', lineHeight: 1.7, color: 'var(--dsw-alias-label-tertiary)' }
    const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }
    const tile = (active) => ({
      appearance: 'none',
      textAlign: 'left',
      border: '1px solid ' + (active ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'),
      background: active ? 'var(--dsw-alias-bg-layer-3)' : 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      borderRadius: '10px',
      padding: '12px 14px',
      font: 'inherit',
      cursor: 'pointer',
      transition: 'border-color .18s ease, background .18s ease',
    })
    const tileKey = {
      display: 'block',
      fontSize: '11px',
      letterSpacing: '.18em',
      color: 'var(--dsw-alias-label-tertiary)',
      marginBottom: '6px',
    }
    const tileName = { display: 'block', fontSize: '15px', fontWeight: 600 }
    const tileMeta = { display: 'block', marginTop: '4px', fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)' }
    const button = {
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
    const note = { margin: '14px 0 0', fontSize: '12px', lineHeight: 1.8, color: 'var(--dsw-alias-label-tertiary)' }

    /** The theme's mark: a drop over three reeds. */
    function MarshMark(props) {
      const size = props && props.size ? props.size : 18
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: 'M12 3.2c2.6 3.1 4.2 5.3 4.2 7.4a4.2 4.2 0 1 1-8.4 0c0-2.1 1.6-4.3 4.2-7.4Z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M5 20.4c1.8-1.2 3.4-1.2 5.2 0s3.4 1.2 5.2 0 3.4-1.2 3.6 0', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    function readDeck() {
      const deck = typeof window !== 'undefined' ? window.__muelsyseDeck : undefined
      return deck && typeof deck.setOpening === 'function' ? deck : null
    }

    function HubPage() {
      const [tick, setTick] = React.useState(0)
      const [status, setStatus] = React.useState({ loading: true, data: null, error: null })

      React.useEffect(function () {
        const timer = setInterval(function () {
          setTick(function (n) {
            return n + 1
          })
        }, 900)
        return function () {
          clearInterval(timer)
        }
      }, [])

      React.useEffect(
        function () {
          let alive = true
          fetch(STATUS_URL, { cache: 'no-store' })
            .then(function (response) {
              if (!response.ok) throw new Error('HTTP ' + response.status)
              return response.json()
            })
            .then(function (data) {
              if (alive) setStatus({ loading: false, data: data, error: null })
            })
            .catch(function (error) {
              if (alive) setStatus({ loading: false, data: null, error: error })
            })
          return function () {
            alive = false
          }
        },
        [tick],
      )

      const deck = readDeck()
      const opening = deck ? deck.opening() : null
      const track = deck ? deck.track() : null
      const playing = deck ? deck.playing() : false
      const muted = deck && typeof deck.muted === 'function' ? deck.muted() : false
      const online = status.data !== null && status.error === null
      const reports = status.data ? status.data.reportCount : 0

      const pick = function (id) {
        if (deck) deck.setOpening(id)
        setTick(function (n) {
          return n + 1
        })
      }
      const pickTrack = function (index) {
        if (deck) deck.setTrack(index)
        setTick(function (n) {
          return n + 1
        })
      }

      const openingCards = deck
        ? deck.openings.map(function (item) {
            const active = item.id === opening
            return h(
              'button',
              {
                key: item.id,
                type: 'button',
                style: tile(active),
                onClick: function () {
                  pick(item.id)
                },
              },
              h('span', { style: tileKey }, item.id),
              h('span', { style: tileName }, item.title),
              h('span', { style: tileMeta }, active ? '● 当前' : ''),
            )
          })
        : []

      const trackRows = deck
        ? deck.tracks.map(function (item) {
            const active = item.index === track
            return h(
              'button',
              {
                key: item.index,
                type: 'button',
                style: tile(active),
                onClick: function () {
                  pickTrack(item.index)
                },
              },
              h('span', { style: tileKey }, ('0' + (item.index + 1)).slice(-2)),
              h('span', { style: tileName }, item.label),
              h('span', { style: tileMeta }, active ? (playing ? '● 播放中' : '● 已选中') : ' '),
            )
          })
        : []

      return h(
        'div',
        { style: page },
        h('h1', { style: title }, zh.title),
        h('p', { style: subtitle }, zh.subtitle),
        h(
          'div',
          { style: chips },
          h('span', { style: chip }, h('span', { style: dot(online) }), online ? zh['state.online'] : status.loading ? zh['state.loading'] : zh['state.offline']),
          h('span', { style: chip }, zh['state.opening'], ': ', deck ? String(document.getElementById('muelsyse-opening') !== null) : '—'),
          h('span', { style: chip }, zh['state.player'], ': ', muted ? '已静音' : playing ? zh['state.playing'] : zh['state.waiting']),
          h('span', { style: chip }, 'reports ', reports),
        ),
        h(
          'section',
          { style: section },
          h('h2', { style: sectionTitle }, zh['openings.title']),
          h('p', { style: hint }, deck ? zh['openings.hint'] : zh['deck.missing']),
          h('div', { style: grid }, openingCards),
        ),
        h(
          'section',
          { style: section },
          h('h2', { style: sectionTitle }, zh['tracks.title']),
          h('p', { style: hint }, deck ? zh['tracks.hint'] : zh['deck.missing']),
          h('div', { style: grid }, trackRows),
          h(
            'div',
            { style: { marginTop: '12px' } },
            h(
              'button',
              {
                type: 'button',
                style: tile(!muted),
                disabled: !deck,
                onClick: function () {
                  if (deck && typeof deck.setMuted === 'function') deck.setMuted(!muted)
                  setTick(function (n) {
                    return n + 1
                  })
                },
              },
              h('span', { style: tileKey }, 'MUSIC'),
              h('span', { style: tileName }, muted ? '音乐已关' : '音乐开着'),
              h('span', { style: tileMeta }, muted ? '点一下打开' : '点一下静音'),
            ),
          ),
        ),
        h(
          'section',
          { style: section },
          h(
            'button',
            {
              type: 'button',
              style: button,
              disabled: !deck,
              onClick: function () {
                if (deck) deck.replay()
              },
            },
            zh['deck.replay'],
          ),
          h('p', { style: note }, zh['deck.note']),
        ),
      )
    }

    /** Register the sidebar row and its page through the host's own slots. */
    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh: zh,
            en: en,
          }),
        'muelsyse-hub: dictionaries',
      )
      const t = ctx.locale.bind(NS)

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 16,
            label: function () {
              return t('panel')
            },
            locale: NS,
          },
          MarshMark,
        )
      })

      ctx.slots.inject('main', function* () {
        yield ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: function () {
              return { t: t }
            },
          },
          HubPage,
        )
      })

      fetch(HUB_URL, { cache: 'no-store' }).catch(function () {})
    }

    return {
      inject: ['slots', 'locale'],
      apply: apply,
    }
  },
})
