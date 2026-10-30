/**
 * Host half of the Muelsyse hub.
 *
 * The visible page lives in `client.js`; this half owns a tiny
 * `/muelsyse-hub/*` route so the plugin can prove from outside the window that
 * its Client module mounted. It touches no tools, prompts, sessions, or profile
 * files.
 */

/** Requests served since this Host process started. */
const STATE = { pings: 0, lastPing: null }

/** The route needs the Host web server; the plugin stays pending without one. */
export const inject = ['webServer']

/**
 * Mount the self-check route.
 * @param ctx - plugin context carrying the web server.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/muelsyse-hub',
        handler: (req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          if (url.pathname === '/muelsyse-hub/ping') {
            STATE.pings += 1
            STATE.lastPing = Object.fromEntries(url.searchParams.entries())
            res.writeHead(204, { 'cache-control': 'no-store' })
            res.end()
            return
          }
          if (url.pathname === '/muelsyse-hub/status') {
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify({ plugin: 'muelsyse-hub', ...STATE }))
            return
          }
          res.writeHead(404, { 'cache-control': 'no-store' })
          res.end()
        },
      }),
    'muelsyse-hub: status route',
  )
}
