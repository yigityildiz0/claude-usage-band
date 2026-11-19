// Cetvel, the local usage service (a Rust daemon, Windows): when it runs, the band
// hands it the Claude figures it already reads, asks it who of the open chats puts the
// next plan question (a lease, so two chats never ask at once), and reads back the
// other platforms' summary for one line. When it does not run, nothing here shows:
// the band works on its own, as before.
//
// The way in is its loopback HTTP (`$.http.fetch` reaches http://127.0.0.1): the port
// and token are in %LOCALAPPDATA%\Cetvel\baglanti.json. `$.process` would start a CLI
// every few seconds (and is the CLI's alone, not the desktop app's), and reading
// anlik.json alone could not post the figures or take the lease, so HTTP it is.
// The token stays in this module's memory: never logged, drawn or stored.
import type { EngineInterface } from 'claude-code'

import type { Ewma, Limit } from '../types'
import { NB, shownPercent, usedLevel, type Level } from './tahmin'

// `percent` is the share used (the level's colour goes by it, as Claude's rows do); `left`
// is what the band shows: the share still free. `id` is the pool's own, never its platform's.
export type OtherWindow = {
  key: string
  label: string
  percent: number
  left: number
  level: Level
  resetsAt?: number
}
export type Other = {
  id: string
  name: string
  percent: number
  left: number
  window: string
  resetsAt?: number
  windows: OtherWindow[]
  isStale: boolean
  level: Level
}
export type CetvelView = { others: Other[]; isStale: boolean }
export type Lease = 'granted' | 'refused' | 'none'

type Link = { port: number; token: string }

const TIMEOUT_MS = 3_000
const LEASE_TIMEOUT_MS = 2_000
const LINK_EVERY_MS = 30_000
const SNAPSHOT_EVERY_MS = 10_000
const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000]
// shown as stale this long after the service stopped answering, then left out
const STALE_FOR_MS = 10 * 60_000
// one slow answer is no outage: the line greys (and the lease waits) only after two
// failures in a row, or this long without an answer
const QUIET_MS = 20_000
const QUIET_FAILURES = 2
const POOL_STALE_S = 30 * 60

// A pool by the name people know it by, never a plan's name. The id is the pool's own:
// Antigravity has three pools (a Gemini, a Claude/GPT and an Argon one), so its platform
// alone cannot name a line.
const POOL_NAMES: Record<string, string> = {
  agy_gemini: 'Antigravity · Gemini',
  agy_claude_gpt: 'Antigravity · Claude/GPT',
  agy_argon: 'Antigravity · Argon',
}
// a platform's own name, for an id that is the platform alone
const PLATFORM_NAMES: Record<string, string> = { codex: 'Codex', gemini: 'Gemini', agy: 'Antigravity', antigravity: 'Antigravity', deepseek: 'DeepSeek', opencode: 'OpenCode' }
// platforms whose id with a suffix still is the platform: "codex_plus" is Codex
const WHOLE_PLATFORMS = new Set(['codex', 'deepseek', 'opencode'])
const ORDER = ['Codex', 'Antigravity · Gemini', 'Antigravity · Claude/GPT', 'Antigravity · Argon']
const POOL_MODELS: Record<string, string> = {
  agy_gemini: 'Hydrogen, 3.8 Flash',
  agy_claude_gpt: 'Opus, Sonnet, GPT-OSS',
}

// a table's own entry, never one it inherits ("constructor", "toString")
const ownOf = (table: Record<string, string>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined

// plan names, never a platform's: a word of an id that is one is left out
const PLAN_WORDS = new Set(['free', 'plus', 'pro', 'max', 'team', 'teams', 'business', 'enterprise', 'ultra', 'premium', 'basic', 'standard'])
const PLAIN_WORD = /^[a-z][a-z0-9]{1,19}$/

function nameOfId(key: string): string | undefined {
  const id = key.toLowerCase()
  const pool = ownOf(POOL_NAMES, id)
  if (pool) return pool
  const words = id.split(/[^a-z0-9]+/).filter(Boolean)
  const head = words[0] ?? ''
  if (words.length === 1) {
    const whole = ownOf(PLATFORM_NAMES, head)
    if (whole) return whole
  } else if (WHOLE_PLATFORMS.has(head)) return ownOf(PLATFORM_NAMES, head)
  // an id the band does not know: its plain words in a readable form ("agy_foo" is
  // "Agy Foo"), the plan's name left off; nothing readable, no line
  if (!PLAIN_WORD.test(head) || PLAN_WORDS.has(head)) return undefined
  const plain = words.filter(w => PLAIN_WORD.test(w) && !PLAN_WORDS.has(w)).slice(0, 3)
  return plain.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** A pool by the name people know it by: its id first, its platform when the id says nothing. */
function nameOf(id: string, platform: string): string | undefined {
  return nameOfId(id) ?? (platform !== id.toLowerCase() ? nameOfId(platform) : undefined)
}
const WINDOW_TR: Record<string, string> = { '5dk': '5 dk', '5s': '5 sa', gun: 'gün', hafta: 'hafta', ay: 'ay' }
const WINDOW_CELL_TR: Record<string, string> = { '5dk': '5 dk', gun: 'günlük', ay: 'aylık' }
const WINDOW_ORDER = ['5dk', '5s', 'gun', 'hafta', 'ay']
const windowRank = (key: string) => {
  const i = WINDOW_ORDER.indexOf(key)
  return i >= 0 ? i : WINDOW_ORDER.length
}

export const poolModels = (id?: string): string | undefined => (id ? ownOf(POOL_MODELS, id.toLowerCase()) : undefined)

export const windowCellLabel = (w: OtherWindow): string | undefined =>
  w.key === '5s' || w.key === 'hafta' ? undefined : ownOf(WINDOW_CELL_TR, w.key) ?? w.label

export function poolSlots(o?: Other): { shortWin?: OtherWindow; longWin?: OtherWindow } {
  if (!o || typeof o !== 'object') return {}
  const list = Array.isArray(o.windows) ? o.windows : []
  if (list.length === 0) {
    const label = typeof o.window === 'string' && o.window ? o.window : 'hafta'
    const isShort = label === '5 sa' || label === '5 dk'
    const percent = typeof o.percent === 'number' && Number.isFinite(o.percent) ? Math.max(0, Math.min(100, o.percent)) : 0
    const fallback: OtherWindow = {
      key: isShort ? '5s' : 'hafta',
      label,
      percent,
      left: leftShown(o),
      level: o.level,
      ...(typeof o.resetsAt === 'number' && Number.isFinite(o.resetsAt) ? { resetsAt: o.resetsAt } : {}),
    }
    return isShort ? { shortWin: fallback } : { longWin: fallback }
  }
  const shortWin = list.find(w => w.key === '5s' || w.key === '5dk')
  const longWin = list.find(w => w.key === 'hafta' || w.key === 'gun' || w.key === 'ay')
  if (!shortWin && !longWin) {
    return list.length === 1 ? { longWin: list[0] } : { shortWin: list[0], longWin: list[1] }
  }
  return { ...(shortWin ? { shortWin } : {}), ...(longWin ? { longWin } : {}) }
}

export function poolResetWindow(o?: Other, now?: number): OtherWindow | undefined {
  if (!o || typeof o !== 'object') return undefined
  const raw = Array.isArray(o.windows) && o.windows.length > 0 ? o.windows : Object.values(poolSlots(o)).filter((w): w is OtherWindow => !!w)
  const list = raw.filter(
    w => typeof w.resetsAt === 'number' && Number.isFinite(w.resetsAt) && (now === undefined || !Number.isFinite(now) || w.resetsAt > now),
  )
  if (list.length === 0) return undefined
  const exhausted = list.filter(w => w.left === 0).sort((a, b) => (b.resetsAt ?? 0) - (a.resetsAt ?? 0))
  if (exhausted[0]) return exhausted[0]
  return [...list].sort((a, b) => a.left - b.left || (a.resetsAt ?? 0) - (b.resetsAt ?? 0))[0]
}

let link: Link | undefined
// a port and token whose answer was not Cetvel's (another program took the port after
// Cetvel died, its file left behind): not used again until the file names another
let distrusted: string | undefined
let linkReadAt = -Infinity
let isUp = false
let lastOkAt = 0
let failures = 0
let waitUntil = 0
let isBusy = false
// whether this chat has looked at the service yet: before it, its lease is unknown
let hasLooked = false
let etag: string | undefined
let lastAskAt = -Infinity
let lastOrder = -1
let lastTime = 0
type ClaudeView = { limits: Limit[]; at: number; ewma?: Record<string, Ewma> }
let view: { others: Other[]; claude?: ClaudeView } | undefined
let pending: Record<string, unknown> | undefined

/** For a test, or a module that starts over: forget everything. */
export function reset(): void {
  link = undefined
  distrusted = undefined
  linkReadAt = -Infinity
  isUp = false
  lastOkAt = 0
  failures = 0
  waitUntil = 0
  isBusy = false
  hasLooked = false
  etag = undefined
  lastAskAt = -Infinity
  lastOrder = -1
  lastTime = 0
  view = undefined
  pending = undefined
}

class Refused extends Error {
  constructor(readonly status: number) {
    super(`Cetvel ${status}`)
  }
}

const linkKey = (l: Link) => `${l.port}:${l.token}`

/** Whether a body is Cetvel's own: its snapshot says who wrote it. */
function isCetvel(text: string): boolean {
  try {
    const body = JSON.parse(text) as { yazan?: unknown } | null
    return !!body && typeof body === 'object' && body.yazan === 'cetvel'
  } catch {
    return false
  }
}

async function readLink($: EngineInterface): Promise<Link | undefined> {
  try {
    const local = await $.env.get('LOCALAPPDATA')
    if (!local) return undefined
    const raw = JSON.parse(String(await $.fs.read(`${local.replace(/\\/g, '/')}/Cetvel/baglanti.json`))) as Record<string, unknown>
    const port = raw.port
    const token = raw.jeton
    // only the port and the token are taken: the address is always this machine's
    // loopback, whatever else the file names, so the token never goes anywhere else
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return undefined
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) return undefined
    if (distrusted === linkKey({ port, token })) return undefined
    return { port, token }
  } catch {
    return undefined
  }
}

export async function within<T>($: EngineInterface, work: Promise<T>, ms: number): Promise<T> {
  const stop = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = $.clock.sleep(ms, stop ? { signal: stop.signal } : undefined).then(
    () => Promise.reject(new Error('zaman aşımı')),
    () => new Promise<never>(() => {}),
  )
  timer.catch(() => {})
  try {
    return await Promise.race([work, timer])
  } finally {
    stop?.abort()
  }
}

async function call(
  $: EngineInterface,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  ms = TIMEOUT_MS,
): Promise<{ status: number; text: string; headers: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!link) throw new Error('bağlantı yok')
    const headers: Record<string, string> = { authorization: `Bearer ${link.token}`, accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (method === 'GET' && etag) headers['if-none-match'] = etag
    const res = await within(
      $,
      $.http.fetch(`http://127.0.0.1:${link.port}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
      ms,
    )
    // a turned token: the file is read again, once
    if (res.status === 401 && attempt === 0) {
      link = await readLink($)
      continue
    }
    return { status: res.status, text: res.text, headers: (res.headers ?? {}) as Record<string, unknown> }
  }
  throw new Refused(401)
}

function header(headers: Record<string, unknown>, name: string): string | undefined {
  const v = Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1]
  return Array.isArray(v) ? String(v[0]) : typeof v === 'string' ? v : undefined
}

/** Down for a moment only: one failure since the last answer, and that answer recent. */
const isRecent = (now: number) => lastOkAt > 0 && failures < QUIET_FAILURES && now - lastOkAt < QUIET_MS

function failed(now: number): void {
  failures += 1
  waitUntil = now + BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]!
  isUp = false
  // the port may have moved with a restart: read the file again next time
  linkReadAt = -Infinity
}

type Window = { kullanilan?: unknown; kalan?: unknown; sifirlama?: unknown }

function leftOf(w: Window, now: number): number | undefined {
  const reset = typeof w.sifirlama === 'string' ? Date.parse(w.sifirlama) : NaN
  // a window past its reset has started over
  if (Number.isFinite(reset) && reset <= now) return 1
  if (typeof w.kalan === 'number' && Number.isFinite(w.kalan)) return Math.max(0, Math.min(1, w.kalan))
  if (typeof w.kullanilan === 'number' && Number.isFinite(w.kullanilan)) return Math.max(0, Math.min(1, 1 - w.kullanilan))
  return undefined
}

type CetvelForecast = { durum?: unknown; saatlik_hiz?: unknown; bitis_tahmini?: unknown }

/**
 * A window's EWMA forecast (the pool's `tahmin`), as a pace: `saatlik_hiz` is the share
 * of the window used an hour; without it, the pace that reaches `bitis_tahmini` from
 * what is used now. None while Cetvel has no forecast ('tahmin_yok': too few samples).
 */
export function ewmaOf(t: unknown, used: number, resetsAt: string, at: number): Ewma | undefined {
  if (!t || typeof t !== 'object') return undefined
  const f = t as CetvelForecast
  if (f.durum !== 'deneysel' && f.durum !== 'hazir') return undefined
  let ratePerHour: number | undefined
  if (typeof f.saatlik_hiz === 'number' && Number.isFinite(f.saatlik_hiz) && f.saatlik_hiz >= 0) {
    ratePerHour = f.saatlik_hiz * 100
  } else {
    const end = typeof f.bitis_tahmini === 'string' ? Date.parse(f.bitis_tahmini) : NaN
    if (Number.isFinite(end) && Number.isFinite(at) && end > at && Number.isFinite(used) && used >= 0 && used < 100) {
      ratePerHour = ((100 - used) / (end - at)) * 3_600_000
    }
  }
  // a pace past the whole window an hour is no forecast, it is a glitch
  if (ratePerHour === undefined || !Number.isFinite(ratePerHour) || ratePerHour > 100) return undefined
  return { ratePerHour, resetsAt, isReady: f.durum === 'hazir' }
}

/** The line's lead: the figures after it are what is left, not what is used. */
export const OTHER_LEAD = 'Diğer (kalan):'
export const STALE_NOTE = '(Cetvel yanıt vermiyor)'

/** The share still free, as the line shows it (a value kept from before `left` existed: what the used share leaves). */
export const leftShown = (o: Other): number => {
  if (!o || typeof o !== 'object') return 0
  if (typeof o.left === 'number' && Number.isFinite(o.left)) return Math.max(0, Math.min(100, o.left))
  if (typeof o.percent === 'number' && Number.isFinite(o.percent)) return Math.max(0, Math.min(100, 100 - o.percent))
  return 0
}

/** One platform's words on the line, its tightest window named: "Codex %84 hafta". */
export const otherText = (o: Other): string => `${o.name}${NB}%${leftShown(o)}${NB}${o.window}`

/** The whole line, as the hint holds it when the row had to cut it. */
export const otherFull = (list: readonly Other[], isStale: boolean): string =>
  `${OTHER_LEAD} ${list.map(o => `${o.name} %${leftShown(o)} ${o.window}`).join(' · ')}${isStale ? ` ${STALE_NOTE}` : ''}`

/**
 * What of the line fits `cols` cells on its one row (`glyph`: a letter's share of a cell).
 * All of it when it does; else the narrowest platforms first (shown in their own order)
 * and "+N" for the rest. The stale note goes to the hint (`hasNote: false`) when even it
 * does not fit.
 */
export function fitOthers(
  list: readonly Other[],
  cols: number,
  glyph: number,
  isStale = false,
): { shown: Other[]; hidden: number; hasNote: boolean } {
  if (!Array.isArray(list) || list.length === 0 || !Number.isFinite(cols) || cols <= 0 || !Number.isFinite(glyph) || glyph <= 0) {
    return { shown: [], hidden: Array.isArray(list) ? list.length : 0, hasNote: false }
  }
  const total = (picked: readonly Other[], hidden: number, hasNote: boolean) => {
    let chars = OTHER_LEAD.length
    let items = 1
    picked.forEach((o, i) => {
      // each but the last of the row is followed by a " ·"
      chars += otherText(o).length + (i < picked.length - 1 || hidden > 0 ? 2 : 0)
      items += 1
    })
    if (hidden > 0) {
      chars += `+${hidden}`.length
      items += 1
    }
    if (hasNote) {
      chars += STALE_NOTE.length
      items += 1
    }
    // the gaps are whole cells; one cell is kept spare so the row never touches the edge
    return Math.ceil(chars * glyph) + (items - 1) + 1
  }
  if (total(list, 0, isStale) <= cols) return { shown: [...list], hidden: 0, hasNote: isStale }
  const narrow = list.map((o, i) => ({ o, i })).sort((a, b) => otherText(a.o).length - otherText(b.o).length || a.i - b.i)
  for (const hasNote of isStale ? [true, false] : [false]) {
    const picked: { o: Other; i: number }[] = []
    for (const c of narrow) {
      const next = [...picked, c]
      if (total(next.map(x => x.o), list.length - next.length, hasNote) > cols) break
      picked.push(c)
    }
    if (picked.length > 0 || !hasNote) {
      picked.sort((a, b) => a.i - b.i)
      return { shown: picked.map(x => x.o), hidden: list.length - picked.length, hasNote }
    }
  }
  return { shown: [], hidden: list.length, hasNote: false }
}

/** The snapshot (schema 2) as the band shows it; undefined when it is not one to take. */
export function readSnapshot(body: unknown, now: number): { others: Other[]; claude?: ClaudeView } | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const s = body as { sema?: unknown; sira?: unknown; zaman?: unknown; havuzlar?: unknown }
  if (s.sema !== 2 || !s.havuzlar || typeof s.havuzlar !== 'object' || Array.isArray(s.havuzlar)) return undefined
  const order = typeof s.sira === 'number' && Number.isFinite(s.sira) ? s.sira : -1
  const at = typeof s.zaman === 'string' ? Date.parse(s.zaman) : NaN
  // an order that went back is an old answer, unless the service started over (newer time)
  if (order >= 0 && order < lastOrder && !(Number.isFinite(at) && at > lastTime)) return undefined
  lastOrder = order
  if (Number.isFinite(at)) lastTime = at
  // one line per pool, by its id: the pools of one platform never merge into one line
  const best = new Map<string, Other>()
  let claude: ClaudeView | undefined
  for (const [id, raw] of Object.entries(s.havuzlar as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const pool = raw as { platform?: unknown; durum?: unknown; pencereler?: unknown; tahmin?: unknown; kaynak?: { okuma?: unknown; yas_sn?: unknown } }
    if (pool.durum !== 'ok' && pool.durum !== 'bayat') continue
    const platform = String(typeof pool.platform === 'string' ? pool.platform : id.split('_')[0]).toLowerCase()
    const windows = pool.pencereler && typeof pool.pencereler === 'object' && !Array.isArray(pool.pencereler) ? (pool.pencereler as Record<string, Window>) : {}
    // "claude_max" is Claude too: never a line of its own under "Diğer"
    if (platform.split(/[^a-z0-9]/)[0] === 'claude') {
      const limits: Limit[] = []
      const ewma: Record<string, Ewma> = {}
      const forecasts = pool.tahmin && typeof pool.tahmin === 'object' ? (pool.tahmin as Record<string, unknown>) : {}
      for (const [name, kind] of [['5s', 'five_hour'], ['hafta', 'seven_day']] as const) {
        const w = windows[name]
        const left = w ? leftOf(w, now) : undefined
        if (!w || left === undefined) continue
        const reset = typeof w.sifirlama === 'string' && Date.parse(w.sifirlama) > now ? w.sifirlama : undefined
        const percentUsed = Math.round((1 - left) * 1000) / 10
        limits.push({ kind, percentUsed, ...(reset ? { resetsAt: reset } : {}) })
        // a forecast counts only for a running window it can be matched to by its reset
        const e = reset && Object.prototype.hasOwnProperty.call(forecasts, name) ? ewmaOf(forecasts[name], percentUsed, reset, Number.isFinite(at) ? at : now) : undefined
        if (e) ewma[kind] = e
      }
      const read = typeof pool.kaynak?.okuma === 'string' ? Date.parse(pool.kaynak.okuma) : NaN
      if (limits.length > 0 && pool.durum === 'ok') {
        claude = { limits, at: Number.isFinite(read) ? read : Number.isFinite(at) ? at : now, ...(Object.keys(ewma).length > 0 ? { ewma } : {}) }
      }
      continue
    }
    const name = nameOf(id, platform)
    if (!name) continue
    // read every active window of the pool, keeping the tightest as the pool's summary
    const windowsList: OtherWindow[] = []
    let tight: { leftRaw: number; win: OtherWindow } | undefined
    for (const [winKey, w] of Object.entries(windows)) {
      const leftRaw = w && typeof w === 'object' ? leftOf(w, now) : undefined
      if (leftRaw === undefined) continue
      // as the band writes Claude's: 99.6 is not full
      const percent = shownPercent((1 - leftRaw) * 100)
      const left = 100 - percent
      const resetMs = typeof w.sifirlama === 'string' ? Date.parse(w.sifirlama) : NaN
      const resetsAt = Number.isFinite(resetMs) && resetMs > now ? resetMs : undefined
      const label = ownOf(WINDOW_TR, winKey) ?? winKey
      const win: OtherWindow = {
        key: winKey,
        label,
        percent,
        left,
        level: usedLevel(percent),
        ...(resetsAt !== undefined ? { resetsAt } : {}),
      }
      windowsList.push(win)
      if (!tight || leftRaw < tight.leftRaw) tight = { leftRaw, win }
    }
    if (!tight) continue
    windowsList.sort((a, b) => windowRank(a.key) - windowRank(b.key) || a.key.localeCompare(b.key))
    const age = typeof pool.kaynak?.yas_sn === 'number' && Number.isFinite(pool.kaynak.yas_sn) ? pool.kaynak.yas_sn : 0
    const other: Other = {
      id,
      name,
      percent: tight.win.percent,
      left: tight.win.left,
      window: tight.win.label,
      ...(tight.win.resetsAt !== undefined ? { resetsAt: tight.win.resetsAt } : {}),
      windows: windowsList,
      isStale: pool.durum === 'bayat' || age > POOL_STALE_S,
      level: tight.win.level,
    }
    best.set(id, other)
  }
  const rank = (name: string) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length)
  const others = [...best.values()].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id))
  return { others, ...(claude ? { claude } : {}) }
}

/**
 * One look at the service, on its own timer (never inside the band's 3s tick): sends
 * the figures waiting to go, then reads the snapshot every 10 s, a 304 when unchanged.
 */
export async function tick($: EngineInterface, now: number): Promise<void> {
  if (isBusy || now < waitUntil) return
  isBusy = true
  hasLooked = true
  try {
    // the file is read at most every 30 s (and again after a failure): no service, no more
    if (now - linkReadAt >= LINK_EVERY_MS) {
      linkReadAt = now
      link = await readLink($)
    }
    if (!link) {
      isUp = false
      return
    }
    if (pending) {
      const body = pending
      pending = undefined
      const res = await call($, 'POST', '/v1/claude', body)
      if (res.status === 401) throw new Refused(401)
    }
    if (now - lastAskAt >= SNAPSHOT_EVERY_MS || !isUp) {
      lastAskAt = now
      const res = await call($, 'GET', '/v1/anlik')
      // what answers on the port is not Cetvel (no snapshot of its own, or no such
      // path): the token goes there no more, until the file names another port or token
      if ((res.status === 200 && !isCetvel(res.text)) || res.status === 404) {
        if (link) distrusted = linkKey(link)
        link = undefined
        view = undefined
        isUp = false
        return
      }
      if (res.status === 200) {
        const next = readSnapshot(JSON.parse(res.text), now)
        if (next) {
          view = next
          etag = header(res.headers, 'etag')
        }
      } else if (res.status !== 304) throw new Refused(res.status)
    }
    isUp = true
    lastOkAt = now
    failures = 0
  } catch {
    failed(now)
  } finally {
    isBusy = false
  }
}

/** The plan question's lease: 'refused' while another chat holds it; 'none' without the service. */
export async function lease($: EngineInterface, client: string, now: number): Promise<Lease> {
  // asked while the service answered lately, one slow look notwithstanding
  if (!link || !(isUp || isRecent(now))) return 'none'
  try {
    const res = await call($, 'POST', '/v1/claude/kira', { istemci: client, sure_sn: 120 }, LEASE_TIMEOUT_MS)
    if (res.status === 200) return 'granted'
    if (res.status === 409) return 'refused'
    return 'none'
  } catch {
    failed(now)
    return 'none'
  }
}

/** Queues figures for the service; the newest wins, sent on the next look. */
export function send(source: 'oauth_usage' | 'yanit_ratelimits', limits: readonly Limit[], client: string, now: number): void {
  if (!Number.isFinite(now)) return
  const body: Record<string, unknown> = { kaynak: source, okuma: new Date(now).toISOString(), istemci: client }
  for (const l of limits) {
    if (l.kind !== 'five_hour' && l.kind !== 'seven_day') continue
    if (!(l.percentUsed >= 0 && l.percentUsed <= 100) || !l.resetsAt || !(Date.parse(l.resetsAt) > now)) continue
    body[l.kind] = { utilization: l.percentUsed, resets_at: l.resetsAt }
  }
  if (body.five_hour || body.seven_day) pending = body
}

function freshWindow(w: OtherWindow, now: number): OtherWindow {
  if (w.resetsAt === undefined || !Number.isFinite(w.resetsAt) || w.resetsAt > now) return w
  return { key: w.key, label: w.label, percent: 0, left: 100, level: 0 }
}

function freshOther(o: Other, now: number): Other {
  const raw = Array.isArray(o.windows) ? o.windows : []
  if (raw.length === 0) {
    if (o.resetsAt !== undefined && (!Number.isFinite(o.resetsAt) || o.resetsAt <= now)) {
      const { resetsAt: _expired, ...rest } = o
      return { ...rest, percent: 0, left: 100, level: 0 }
    }
    return o
  }
  let changed = false
  const windows = raw.map(w => {
    const next = freshWindow(w, now)
    if (next !== w) changed = true
    return next
  })
  if (!changed) return o
  const tight = [...windows].sort((a, b) => a.left - b.left || windowRank(a.key) - windowRank(b.key))[0]
  if (!tight) return o
  const { resetsAt: _expired, ...rest } = o
  return {
    ...rest,
    percent: tight.percent,
    left: tight.left,
    window: tight.label,
    ...(tight.resetsAt !== undefined ? { resetsAt: tight.resetsAt } : {}),
    windows,
    level: tight.level,
  }
}

/** Claude's figures as the service last had them (from any chat, or the status line). */
export function claudeOf(now: number): { limits: Limit[]; at: number } | undefined {
  if (!view?.claude || !(isUp || now - lastOkAt < STALE_FOR_MS)) return undefined
  const limits = view.claude.limits.map(l => {
    const resetMs = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    return l.resetsAt && (!Number.isFinite(resetMs) || resetMs <= now) ? { kind: l.kind, percentUsed: 0 } : l
  })
  return { limits, at: view.claude.at }
}

/** Cetvel's EWMA pace per window, while it answers (one slow look aside); else none: the band's own. */
export function ewmaNow(now: number): Record<string, Ewma> | undefined {
  if (!(isUp || isRecent(now)) || !view?.claude?.ewma) return undefined
  const fresh = Object.fromEntries(
    Object.entries(view.claude.ewma).filter(([, e]) => {
      const t = e.resetsAt ? Date.parse(e.resetsAt) : NaN
      return Number.isFinite(t) && t > now
    }),
  )
  return Object.keys(fresh).length > 0 ? fresh : undefined
}

/** The other platforms for the band's line: none without the service or after 10 minutes down. */
export function viewOf(now: number): CetvelView | null {
  if (!view || view.others.length === 0) return null
  if (!(isUp || isRecent(now) || now - lastOkAt < STALE_FOR_MS)) return null
  return { others: view.others.map(o => freshOther(o, now)), isStale: !(isUp || isRecent(now)) }
}

/** Whether this chat has looked at the service since it opened (a lease asked before means nothing). */
export function looked(): boolean {
  return hasLooked
}

export function isLinked(): boolean {
  return isUp
}
