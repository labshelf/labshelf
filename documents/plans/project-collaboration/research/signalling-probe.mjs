// Measures how fast and how often two trystero peers meet per signalling strategy, in headless Chromium pages.
// Deps (Node >= 22): npm i @trystero-p2p/nostr @trystero-p2p/torrent @trystero-p2p/mqtt playwright-core esbuild
// Browser: npx playwright-core install chromium-headless-shell, or pass --chrome <path to a Chromium binary>.
// Flags: --strategy nostr|torrent|mqtt --role host|guest|both --room ID --count N --timeout S --slot S --start EPOCH_MS
//        --ice '[TURN iceServers JSON]' --password P --intruder 1 (both only) --grace MS --app ID --chrome PATH
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { createRequire } from 'node:module'
import { setTimeout as sleep } from 'node:timers/promises'

const flags = process.argv.slice(2)
const a = Object.fromEntries(flags.flatMap((f, i) => (f.startsWith('--') ? [[f.slice(2), flags[i + 1]]] : [])))
const num = (k, d) => (a[k] === undefined ? d : Number(a[k]))
const count = num('count', 30), timeout = num('timeout', 30), slotMs = num('slot', timeout + 5) * 1000
const room = a.room ?? 'ls-' + Math.random().toString(36).slice(2, 8)
const roles = a.role === 'both' ? (a.intruder ? ['host', 'guest', 'intruder'] : ['host', 'guest']) : [a.role]
const pctl = (xs, p) => (xs.length ? [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)] : null)

// Runs inside the page: joins one room, pings every peer, resolves on the first pong or the timeout.
const pageEntry = `
import * as nostr from '@trystero-p2p/nostr'; import * as torrent from '@trystero-p2p/torrent'; import * as mqtt from '@trystero-p2p/mqtt'
const mods = { nostr, torrent, mqtt }
window.defaults = Object.fromEntries(Object.entries(mods).map(([k, m]) => [k, m.defaultRelayUrls]))
window.probe = async ({ strategy, roomId, password, ice, timeout, grace, app }) => {
  const mod = mods[strategy], t0 = performance.now(), r = { ok: false, peers: 0, joinErrors: [] }
  const cfg = { appId: app, ...(password && { password }), ...(ice && { turnConfig: ice }) }
  const joined = mod.joinRoom(cfg, roomId, { onJoinError: (d) => r.joinErrors.push(d.error) })
  const msg = joined.makeAction('probe')
  let finish; const done = new Promise((res) => (finish = res))
  const seen = new Set()
  joined.onPeerJoin = (id) => { r.peers = seen.add(id).size; r.tPeer ??= Math.round(performance.now() - t0); msg.send('ping', { target: id }) }
  msg.onMessage = (data, { peerId }) => {
    if (data === 'ping') return msg.send('pong', { target: peerId })
    r.tRtt ??= Math.round(performance.now() - t0); r.ok = true; finish()
  }
  const timer = setTimeout(() => ((r.error = 'timeout'), finish()), timeout * 1000)
  await done; clearTimeout(timer)
  await new Promise((res) => setTimeout(res, grace))
  r.relays = Object.values(mod.getRelaySockets()).map((s) => [s.url, s.readyState === 1])
  await Promise.race([joined.leave(), new Promise((res) => setTimeout(res, 3000))])
  return r
}`

async function openPage(browser, bundle) {
  const page = await (await browser.newContext()).newPage()
  await page.route('https://probe.invalid/', (route) => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
  await page.goto('https://probe.invalid/')
  await page.addScriptTag({ content: bundle })
  return page
}

function summarize(role, results) {
  const okR = results.filter((r) => r.ok), relays = {}, errors = {}
  for (const [u, open] of results.flatMap((r) => r.relays)) (relays[u] ??= { open: 0, total: 0 }, relays[u].total++, (relays[u].open += open ? 1 : 0))
  for (const r of results.filter((x) => !x.ok)) { const k = r.error + (r.joinErrors[0] ? ': ' + r.joinErrors[0] : ''); errors[k] = (errors[k] ?? 0) + 1 }
  const stat = (k) => [pctl(okR.map((r) => r[k]), 0.5), pctl(okR.map((r) => r[k]), 0.9)]
  return { summary: true, role, strategy: a.strategy, joins: results.length, successes: okR.length, peerMsMedianP90: stat('tPeer'), rttMsMedianP90: stat('tRtt'), errors, relays }
}

const { outputFiles } = await build({ stdin: { contents: pageEntry, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' })
const browser = await chromium.launch({ executablePath: a.chrome, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] })
let defaults
const start = num('start', Math.ceil((Date.now() + 10000) / 60000) * 60000), all = roles.map(() => [])
for (let i = 1; i <= count; i++) {
  if (a.role !== 'both') await sleep(Math.max(0, start + (i - 1) * slotMs - Date.now()))
  const opts = (role) => ({ strategy: a.strategy, roomId: `${room}-${i}`, password: role === 'intruder' ? 'wrong' : a.password, ice: a.ice && JSON.parse(a.ice), timeout, grace: num('grace', 0), app: a.app ?? 'labshelf-probe' })
  // INVARIANT: every join uses a fresh context; trystero multiplexes rooms over one connection between the same two peers.
  const pages = await Promise.all(roles.map(() => openPage(browser, outputFiles[0].text)))
  const rs = await Promise.all(pages.map((p, k) => p.evaluate((o) => window.probe(o), opts(roles[k]))))
  defaults = await pages[0].evaluate((s) => window.defaults[s], a.strategy)
  await Promise.all(pages.map((p) => p.context().close()))
  rs.forEach((r, k) => { all[k].push(r); console.log(JSON.stringify({ i, role: roles[k], ...r })) })
}
const version = createRequire(import.meta.url)('@trystero-p2p/core/package.json').version
roles.forEach((role, k) => console.log(JSON.stringify({ ...summarize(role, all[k]), trystero: version, defaultRelays: defaults })))
await browser.close()
