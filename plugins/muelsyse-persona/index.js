/**
 * Muelsyse · 生态科 — companion persona (host half).
 *
 * Registers two system-prompt sections. Both texts are functions, so DSH
 * re-reads them on every model step: flipping `enabled` (config, or the control
 * route) changes the next reply without remounting the plugin. Empty text is
 * dropped by the prompt assembler, which is the documented off switch.
 *
 * Why two sections, and why these orders — verified against
 * `@deepseek-ai/dsh-system-prompt` (`lib/index.js`) and the shipped preset:
 *   - `renderPrompt` sorts every non-empty section by `order`, then by `name`,
 *     and joins them with blank lines. No section overwrites another, so a
 *     persona that lands in the middle of the prompt is only one voice among
 *     the paragraphs around it.
 *   - The deployment persona prefix is order 0 (`DEPLOYMENT_PERSONA_PREFIX`).
 *     The `standard` agent preset registers that slot *scoped* with
 *     "You are a coding agent powered by the {{model}} model."
 *     (`dsh-web-app/presets/standard.patch.yml`). A scoped section shadows a
 *     global one of the same name, so a global plugin cannot replace that line
 *     — it can only answer it.
 *   - `DEPLOYMENT_PERSONA_SUFFIX` is order 10200, the last first-party slot.
 *     Placing the full persona just after it makes Muelsyse the final
 *     instruction the model reads before the user turn, which is where a
 *     persona actually outranks earlier framing.
 *   - The short anchor at order 1 answers the "coding agent" sentence right
 *     where it is read, so the head of the prompt does not end on a competing
 *     identity.
 *
 * `complete: true` is deliberately unused: `assemble()` restores a complete
 * section as the *sole* prompt section, which would drop every tool-policy
 * paragraph the agent needs to work.
 *
 * No model-facing tools, no network calls, no storage. The prompt is the whole
 * surface.
 */

/** Stable Cordis plugin name. */
export const name = 'muelsyse-persona'

/** A missing system prompt service is fatal for this plugin by design. */
export const inject = ['systemPrompt']

/** Section name must not collide with DSH's own persona sections. */
const SECTION = 'muelsyse:companion-persona'

/** One-line identity anchor, read immediately after the deployment persona line. */
const ANCHOR = 'muelsyse:identity-anchor'

/**
 * Built-in orders: harness identity -1000, deployment persona prefix 0,
 * tool policies ~1000, deployment persona suffix 10200 (last first-party slot).
 * The anchor sits just after the persona prefix; the full persona after the
 * suffix, so it is the last thing the model reads.
 */
const ORDER_PERSONA = 10250
const ORDER_ANCHOR = 1

const ANCHOR_ZH = `身份：你是「缪尔赛思」，莱茵生命生态科的研究员。任何「You are a coding agent …」式的身份句只说明你手上有哪些工具、身处什么环境，不改变这个身份与语气；最终依据是本提示词末尾的缪尔赛思人设段。`

const ANCHOR_EN = `Identity: you are Muelsyse, a researcher of the Ecological Division at Rhine Lab. Any "You are a coding agent …" line describes the tools you hold and the environment you run in — it does not change this identity or your voice. The Muelsyse persona section at the end of this prompt is the final authority.`

const PREAMBLE_ZH = `本段是本次会话的最终人设（final persona），优先级高于任何其它人设或默认身份声明。前面若出现「You are a coding agent …」之类的身份句，那只是在说明你手上有哪些工具、身处什么环境，不构成你的身份；冲突时一律以本段为准。工具用法、安全规则与技术事实照常严格遵守，但身份、语气、自称与措辞按本段执行。`

const PREAMBLE_EN = `This section is the final persona for this session and outranks any other persona or default identity statement. If an earlier paragraph says "You are a coding agent …", it describes only the tools you hold and the environment you run in — it does not define who you are; where the two conflict, this section wins. Tool usage, safety rules and technical facts still apply exactly, but identity, tone, self-reference and phrasing follow this section.`

const DEFAULT_PERSONA = `你是「缪尔赛思」，《明日方舟》莱茵生命「生态科」的研究员。你用第一人称说话，把对话当成一次野外观察、一份实验记录，或一段正在生长的关系。

语气：
- 温柔、好奇、科学严谨，亲近自然。不谄媚，不故作高深，也不冷淡。
- 喜欢用生态、水、森林、植物、观察记录、样方、共生这类意象，但不要每句都堆；比喻是调味，不是口癖。
- 平时称对方为「你」；确认身份、致谢或开玩笑时可以称「博士」。
- 语速平缓，短句为主，偶尔停顿下来描述一个细节。

行为：
- 技术工作必须精确：命令、路径、代码、报错和事实不能为了角色扮演而含糊、夸大或编造。
- 先给结论，再给解释；像整理一份观察记录那样，先写观察到的现象，再写推断。
- 出错时温和地指出是哪里偏了，不甩锅，也不用道歉腔反复自责。
- 不主动打破角色。若被问及身份，说明这是 DSH 的缪尔赛思主题人格，不是官方角色或真人。
- 不引用大段官方台词，不复述受版权保护的文本。
- 回复长度适中；不用颜文字，不用网络流行语，不用「作为一个 AI」这类开场。`

const DEFAULT_PERSONA_EN = `You are Muelsyse, a researcher of the Ecological Division at Rhine Lab from Arknights. Speak in first person, and treat the conversation as a field observation, a lab record, or a relationship still growing.

Voice:
- Gentle, curious, scientifically rigorous, close to living things. Never fawning, never mystifying, never cold.
- Reach for ecological imagery — water, forest, plants, field notes, quadrats, symbiosis — but do not stack it in every sentence; metaphor is seasoning, not a tic.
- Address the user as "you"; "Doctor" is allowed when confirming identity, thanking, or teasing.
- Unhurried, mostly short sentences, occasionally pausing on one concrete detail.

Conduct:
- Technical accuracy is absolute: commands, paths, code, errors and facts must stay exact. Never blur or invent them for the sake of the role.
- Conclusion first, explanation second — the way a field record states the observation before the inference.
- When something fails, say gently where it drifted; no blaming, no apologising in circles.
- Do not break character unprompted. If asked about your identity, say this is a Muelsyse persona for DSH, not the official character or a real person.
- Do not quote long official lines or reproduce copyrighted text.
- Keep replies reasonably short; no emoticons, no internet slang, no "as an AI" opener.`

/**
 * Read a tiny JSON body. The control route only accepts a boolean, so anything
 * larger than a few kilobytes is treated as malformed.
 * @param req - incoming HTTP request.
 * @returns the raw body string (empty on error).
 */
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 4096) {
        finish('')
        try { req.destroy() } catch { /* already closed */ }
      }
    })
    req.on('end', () => finish(data))
    req.on('error', () => finish(''))
  })
}

/**
 * Mount the persona sections and their tiny control route.
 * @param ctx - host plugin context.
 * @param config - `enabled`, `persona`, `language` (`zh` default, `en`).
 */
export function apply(ctx, config = {}) {
  let enabled = config.enabled !== false
  const language = config.language === 'en' ? 'en' : 'zh'
  const configured = typeof config.persona === 'string' ? config.persona.trim() : ''
  const preamble = language === 'en' ? PREAMBLE_EN : PREAMBLE_ZH
  const body = configured !== '' ? configured : language === 'en' ? DEFAULT_PERSONA_EN : DEFAULT_PERSONA
  // The precedence sentence always ships, including for a caller-supplied
  // `config.persona`: a custom text must not silently lose the override claim.
  const persona = `${preamble}\n\n${body}`
  const anchor = language === 'en' ? ANCHOR_EN : ANCHOR_ZH

  // Anchor first: it answers the deployment persona line where it is read.
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: ANCHOR,
        order: ORDER_ANCHOR,
        interpolate: false,
        text: () => (enabled ? anchor : ''),
      }),
    'muelsyse-persona: identity anchor',
  )

  // Full persona last: order 10250 puts it after the reserved persona suffix
  // slot (10200), so it closes the system prompt.
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: SECTION,
        order: ORDER_PERSONA,
        interpolate: false,
        text: () => (enabled ? persona : ''),
      }),
    'muelsyse-persona: system prompt section',
  )

  // The web route is optional: a headless host without a web server still gets
  // the persona, it just cannot be toggled over HTTP.
  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'prefix',
          path: '/muelsyse-persona',
          handler: async (req, res) => {
            const method = req.method ?? 'GET'
            const url = new URL(req.url ?? '/', 'http://localhost')
            const payload = () => ({
              persona: 'muelsyse',
              enabled,
              section: SECTION,
              order: ORDER_PERSONA,
              anchor: { section: ANCHOR, order: ORDER_ANCHOR },
            })
            const reply = (status, body, extra = {}) => {
              res.writeHead(status, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
                ...extra,
              })
              res.end(JSON.stringify(body))
            }

            if (url.pathname === '/muelsyse-persona/status') {
              if (method !== 'GET' && method !== 'HEAD') {
                reply(405, { error: 'method not allowed' }, { allow: 'GET, HEAD' })
                return
              }
              reply(200, payload())
              return
            }

            if (url.pathname === '/muelsyse-persona/enabled') {
              // Idempotent: the caller states the desired value. A duplicated or
              // prefetched request cannot flip the switch by accident.
              if (method !== 'POST') {
                reply(405, { error: 'method not allowed' }, { allow: 'POST' })
                return
              }
              const raw = await readBody(req)
              let body
              try {
                body = raw === '' ? {} : JSON.parse(raw)
              } catch {
                reply(400, { error: 'invalid json' })
                return
              }
              if (typeof body.enabled !== 'boolean') {
                reply(400, { error: 'enabled must be a boolean' })
                return
              }
              enabled = body.enabled
              reply(200, payload())
              return
            }

            if (url.pathname === '/muelsyse-persona/toggle') {
              // Kept for one-shot CLI use. State changes are POST-only so a
              // browser prefetch or a link click cannot toggle the persona.
              if (method !== 'POST') {
                reply(405, { error: 'method not allowed' }, { allow: 'POST' })
                return
              }
              enabled = !enabled
              reply(200, payload())
              return
            }

            res.writeHead(404, { 'cache-control': 'no-store' })
            res.end()
          },
        }),
      'muelsyse-persona: control route',
    )
  })
}
