import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { AutoCompact, Category, Ewma, Hold, Limit, Mode, Opening, Original, PaceOf, Snapshot, View } from '../types'
import {
  claudeOf as cetvelClaude,
  ewmaNow as cetvelEwma,
  lease as cetvelLease,
  looked as cetvelLooked,
  poolModels,
  poolResetWindow,
  poolSlots,
  reset as cetvelReset,
  send as cetvelSend,
  tick as cetvelLook,
  viewOf as cetvelView,
  windowCellLabel,
  within,
  STALE_NOTE,
  type Other,
  type OtherWindow,
} from './cetvel'
import { AT_DEFAULT, BY_DEFAULT, BY_HAND, raiseDefaults, sharedSource, storedOf, storedSource, type Source } from './esik'
import { configDir, get as keepGet, healthOf as storeHealth, probe as probeStore, set as keepSet, whenBroken } from './kalici'
import { beat, readShared, writeShared } from './shared'
import {
  WINDOWS,
  binding,
  detailNoteOf,
  duration,
  earlyText,
  forecast,
  headline,
  isEarly,
  leftMarkerOf,
  leftOf,
  markerOf,
  shortClock,
  shortHeadline,
  shownPercent,
  spaceDuration,
  type Forecast,
  type Level,
} from './tahmin'

const snapshot = atom({ plugin: 'kota-bandi', key: 'snapshot' } as const, null)
const isOn = atom({ plugin: 'kota-bandi', key: 'isOn' } as const, true)
const view = atom({ plugin: 'kota-bandi', key: 'view' } as const, { mode: 'detayli', last: 'detayli' } as View)
const autoCompact = atom({ plugin: 'kota-bandi', key: 'autoCompact' } as const, { isOn: false, at: null } as AutoCompact)
const autoAsk = atom({ plugin: 'kota-bandi', key: 'autoAsk' } as const, null as { at: number; percent: number } | null)
// what holds auto compact back, and in which chat: kept in state so a reload (an
// update, /reload-plugins) keeps it, where a module variable would start over
const hold = atom({ plugin: 'kota-bandi', key: 'hold' } as const, { chat: '', waits: false, stuck: false } as Hold)
const original = atom({ plugin: 'kota-bandi', key: 'original' } as const, { state: 'none', id: '' } as Original)
const others = atom({ plugin: 'kota-bandi', key: 'others' } as const, null as { others: Other[]; isStale: boolean } | null)
// whether this chat's first turn here has started: kept in state, so a reload (an
// update, /reload-plugins) does not take a warm chat for one just reopened
const opening = atom({ plugin: 'kota-bandi', key: 'opening' } as const, { chat: '', done: false } as Opening)

// One palette for light and dark alike, so the band never has to know the app's theme
// (that was read from the desktop app's config file, which also holds its sign-in
// cache: not a file to open). Normal copy uses the surface's own `text` colour; status
// text uses Claude Code's semantic ThemeKeys (`success`, `warning`, `error`), which adapt
// to light and dark themes at >= 4.5:1 text contrast with no background highlight.
// Bars, dots and swatches sit near L ≈ 0.20 (~3.6-4.0:1 against #262624 and #faf9f5),
// and the empty track is a see-through grey with a subtle border on either ground.
const FILL = ['#149245', '#c26606', '#e14348'] as const
const TEXT_STATUS = ['success', 'warning', 'error'] as const
const MUTED = 'inactive'
const TRACK_FILL_SVG = '#8a8f9c26'
const TRACK_STROKE_SVG = '#8a8f9c54'
// the terminal's cells take no see-through colour: its theme's own muted grey
const TRACK_CELL = 'inactive'
const TICK = '#767d8d'
const SWATCH: Record<string, string> = { Messages: '#0987a8', Tools: '#7968eb', Other: '#767d8d' }
const BUFFER = '#767d8d99'
const BUFFER_CELL = '#767d8d'
const SWITCH_OFF = '#767d8d'
const SWITCH_ON = '#149245'
// the light under the pointer, see-through so it reads on either ground
const LIT = '#8a8f9c2e'
const LIT_BORDER = '#8a8f9c5c'
// fully see-through: the unlit border, and the press's own hover tint, which drew a
// square frame round the light (the word "transparent" draws white or nothing)
const CLEAR = '#00000000'

// 5 hour on the left, Weekly on the right
const order = (kind: string) => (kind === 'five_hour' ? 0 : 1)

// Context by what it holds, as shown (rounded): amber from 50% (a long context costs
// more on every reply: compacting pays), red from 80%
const CONTEXT_AMBER_AT = 50
const CONTEXT_RED_AT = 80
function fillLevel(percent: number): Level {
  if (!Number.isFinite(percent)) return 0
  const shown = Math.round(percent)
  return shown >= CONTEXT_RED_AT ? 2 : shown >= CONTEXT_AMBER_AT ? 1 : 0
}

function tokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  // 1M, not 1.0M or 1000k; 1.5M keeps its decimal
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return `${Math.round(n)}`
}

type Segment = { color: string; share: number; kind?: 'used' | 'buffer' | 'free' }

const BAR_PX = 6
const SVG_BAR_H = 10
const SVG_BAR_Y = (SVG_BAR_H - BAR_PX) / 2
const BAR_R = BAR_PX / 2

// an iOS-style switch: a slim pill, the knob right and green when on, left and grey when off
const SWITCH_W = 30
const SWITCH_H = 18
const SWITCH_PAD = 2
// the cells the switch's box takes: the press under it is clipped to this, so the
// app's own button tint can't spill onto the text beside it
const SWITCH_CELLS = 4
// the box behind the switch measures a pixel off the drawing: nudge half a pixel
// so the pill sits in the hover light's centre
const SWITCH_NUDGE = 0.5

function switchSvg(on: boolean): string {
  const w = SWITCH_W - 2 * SWITCH_PAD
  const tall = SWITCH_H - 2 * SWITCH_PAD
  const p = SWITCH_PAD
  const knob = p + (on ? w - tall / 2 : tall / 2)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SWITCH_W}" height="${SWITCH_H}" viewBox="${-SWITCH_NUDGE} ${-SWITCH_NUDGE} ${SWITCH_W} ${SWITCH_H}">` +
    `<rect x="${p}" y="${p}" width="${w}" height="${tall}" rx="${tall / 2}" fill="${on ? SWITCH_ON : SWITCH_OFF}"/>` +
    `<circle cx="${knob}" cy="${p + tall / 2}" r="${tall / 2 - 2}" fill="#ffffff"/></svg>`
  )
}

// the hidden band's button: a soft squircle holding three rounded bars and a status dot
const HIDDEN_W = 24
const HIDDEN_H = 22
const HIDDEN_CELLS = 4
function hiddenSvg(level: Level): string {
  const bars = [
    { y: 7, w: 8 },
    { y: 10.1, w: 12 },
    { y: 13.2, w: 10 },
  ]
    .map(b => `<rect x="6" y="${b.y}" width="${b.w}" height="1.8" rx="0.9" fill="${TICK}"/>`)
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${HIDDEN_W}" height="${HIDDEN_H}" viewBox="0 0 ${HIDDEN_W} ${HIDDEN_H}">` +
    `<rect x="1" y="1" width="22" height="20" rx="6.5" fill="#8a8f9c18" stroke="#8a8f9c5c" stroke-width="1.25"/>${bars}` +
    `<circle cx="18.5" cy="5.5" r="2.6" fill="${FILL[level]}"/></svg>`
  )
}

// a thin rounded bar drawn in 1:1 pixel units so pill corners never squash, with a
// translucent bordered track and an optional 2px pace tick extending above and below
function barSvg(segments: Segment[], width: number, marker?: number): string {
  const px = Math.max(24, Number.isFinite(width) ? Math.round(width) : 24)
  const clean = segments.map(s => ({ ...s, share: Number.isFinite(s.share) && s.share > 0 ? s.share : 0 }))
  const total = clean.reduce((sum, s) => sum + s.share, 0) || 1
  const filled = clean.filter(s => s.kind !== 'free' && s.share > 0)
  const isSingleFill = filled.length === 1 && clean.some(s => s.kind === 'free')
  let x = 0
  const rects = filled
    .map(s => {
      const rawW = (s.share / total) * px
      const w = Math.min(px - x, Math.max(2, rawW))
      const rx = isSingleFill ? Math.min(BAR_R, w / 2) : 0
      const rect = `<rect x="${x.toFixed(2)}" y="${SVG_BAR_Y}" width="${w.toFixed(2)}" height="${BAR_PX}" rx="${rx.toFixed(2)}" fill="${s.color}"/>`
      x += w
      return rect
    })
    .join('')
  const track = `<rect x="0.5" y="${(SVG_BAR_Y + 0.5).toFixed(2)}" width="${px - 1}" height="${BAR_PX - 1}" rx="${(BAR_R - 0.5).toFixed(2)}" fill="${TRACK_FILL_SVG}" stroke="${TRACK_STROKE_SVG}" stroke-width="1"/>`
  const TICK_PX = 2
  let tick = ''
  if (marker !== undefined && Number.isFinite(marker)) {
    const clamped = Math.max(0, Math.min(100, marker))
    const tickX = Math.min(px - TICK_PX, Math.max(0, Math.round((clamped / 100) * px - TICK_PX / 2)))
    const filledRatio = x / px
    const insideFill = filled.length > 0 && clamped / 100 <= filledRatio
    tick =
      `<rect x="${tickX.toFixed(1)}" y="0" width="${TICK_PX}" height="${SVG_BAR_H}" rx="1" fill="${TICK}"/>` +
      (insideFill ? `<rect x="${(tickX + 0.5).toFixed(1)}" y="${SVG_BAR_Y}" width="1" height="${BAR_PX}" fill="#ffffff" opacity="0.88"/>` : '')
  }
  const clipId = `r-${px}`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${SVG_BAR_H}" viewBox="0 0 ${px} ${SVG_BAR_H}">` +
    `<clipPath id="${clipId}"><rect x="0" y="${SVG_BAR_Y}" width="${px}" height="${BAR_PX}" rx="${BAR_R}" ry="${BAR_R}"/></clipPath>` +
    `${track}<g clip-path="url(#${clipId})">${rects}</g>${tick}</svg>`
  )
}

type CellRun = { color: string; text: string }

// the terminal's bar: slim line glyphs (━ filled, ┄ buffer, ─ empty track, ┃ pace tick)
function limitCellRuns(f: Forecast, cells: number): CellRun[] {
  const n = Math.max(1, Number.isFinite(cells) ? Math.floor(cells) : 1)
  const pct = Number.isFinite(f.percent) ? f.percent : 0
  const filled = Math.max(0, Math.min(n, Math.round((pct / 100) * n)))
  const marker = markerOf(f)
  const tick =
    marker === undefined || !Number.isFinite(marker) || filled >= n
      ? -1
      : Math.max(filled, Math.min(n - 1, Math.round((marker / 100) * n) - 1))
  const runs: CellRun[] = []
  if (filled > 0) runs.push({ color: FILL[f.level], text: '━'.repeat(filled) })
  if (tick >= filled) {
    if (tick > filled) runs.push({ color: TRACK_CELL, text: '─'.repeat(tick - filled) })
    runs.push({ color: TICK, text: '┃' })
    if (tick + 1 < n) runs.push({ color: TRACK_CELL, text: '─'.repeat(n - tick - 1) })
  } else if (filled < n) {
    runs.push({ color: TRACK_CELL, text: '─'.repeat(n - filled) })
  }
  return runs
}

// remaining bar on terminal: filled = remaining share, tick = projected end-of-window left
function remainingCellRuns(leftPct: number, level: Level, cells: number, marker?: number): CellRun[] {
  const n = Math.max(1, Number.isFinite(cells) ? Math.floor(cells) : 1)
  const pct = Number.isFinite(leftPct) ? leftPct : 0
  const filled = Math.max(0, Math.min(n, Math.round((pct / 100) * n)))
  const tick =
    marker === undefined || !Number.isFinite(marker) || filled >= n
      ? -1
      : Math.max(0, Math.min(n - 1, Math.round((marker / 100) * n)))
  const runs: CellRun[] = []
  const push = (color: string, text: string) => {
    if (!text) return
    const prev = runs[runs.length - 1]
    if (prev && prev.color === color) prev.text += text
    else runs.push({ color, text })
  }
  for (let i = 0; i < n; i++) {
    if (i === tick) push('text', '┃')
    else if (i < filled) push(FILL[level], '━')
    else push(TRACK_CELL, '─')
  }
  return runs
}

function contextCellRuns(segments: Segment[], cells: number): CellRun[] {
  const n = Math.max(1, Number.isFinite(cells) ? Math.floor(cells) : 1)
  const clean = segments.map(s => ({ ...s, share: Number.isFinite(s.share) && s.share > 0 ? s.share : 0 }))
  const total = clean.reduce((sum, s) => sum + s.share, 0) || 1
  const parts = clean.map((s, i) => {
    const exact = (s.share / total) * n
    const count = Math.floor(exact)
    return { s, i, count, rem: exact - count }
  })
  let left = n - parts.reduce((sum, p) => sum + p.count, 0)
  for (const p of [...parts].sort((a, b) => b.rem - a.rem)) {
    if (left <= 0) break
    p.count += 1
    left -= 1
  }
  return parts
    .filter(p => p.count > 0)
    .map(p => ({
      color: p.s.kind === 'free' ? TRACK_CELL : p.s.color,
      text: (p.s.kind === 'free' ? '─' : p.s.kind === 'buffer' ? '┄' : '━').repeat(p.count),
    }))
}

// The usage service rate-limits per login, and the app's own Usage panel asks it on
// the same allowance, so ask it seldom: when a chat opens, then every 2 minutes with the
// exact context count, one ask for the whole app (Cetvel's lease when it runs, else when
// it was last asked, kept for every chat). Between asks the figures every reply from
// Claude carries keep the band current.
const PLAN_EVERY_MS = 2 * 60_000
// timers drift: a 2-minute tick a moment early still counts as due
const PLAN_SLACK_MS = 10_000
// after a failed ask wait 2, then 5, then 15 minutes, or what the service says
const PLAN_BACKOFF_MS = [120_000, 300_000, 900_000]
// a hook may run 10 s: the ask gives up before that
const PLAN_TIMEOUT_MS = 8_000
const LOCAL_EVERY_MS = 3_000

type Backoff = { until: number; failures: number; error: string }
/** 'no': the 3s tick, never asks; 'due': asks if 2 minutes have passed app-wide; 'now': asks unless backed off */
type Ask = 'no' | 'due' | 'now'

class AskError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

// The plan's limits, as the app's "Plan usage limits" panel reads them: the account's
// usage endpoint, through the session's own credential (the plugin never sees it).
async function fetchPlan($: EngineInterface): Promise<Limit[] | null> {
  const auth = await $.session.authorize()
  // no Claude login (an API key, a gateway): there is no plan to ask about
  if (!auth || auth.kind !== 'bearer') return null
  let res: Awaited<ReturnType<EngineInterface['http']['fetch']>>
  try {
    res = await within(
      $,
      $.http.fetch('https://api.anthropic.com/api/oauth/usage', {
        auth: auth.handle,
        headers: { 'anthropic-beta': 'oauth-2025-04-20', 'content-type': 'application/json' },
      }),
      PLAN_TIMEOUT_MS,
    )
  } catch (error) {
    throw new AskError(error instanceof Error && error.message === 'zaman aşımı' ? 'zaman aşımı' : 'bağlantı kurulamadı')
  }
  if (!res.ok) {
    const header = Object.entries(res.headers ?? {}).find(([k]) => k.toLowerCase() === 'retry-after')?.[1]
    const seconds = Number(Array.isArray(header) ? header[0] : header)
    const retry = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
    throw new AskError(res.status === 429 ? 'reddedildi (429)' : `başarısız (${res.status})`, retry)
  }
  let body: Record<string, { utilization?: number | null; resets_at?: string | null } | null>
  try {
    const parsed = JSON.parse(res.text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad')
    body = parsed as Record<string, { utilization?: number | null; resets_at?: string | null } | null>
  } catch {
    throw new AskError('geçersiz yanıt')
  }
  const limits: Limit[] = []
  for (const kind of ['five_hour', 'seven_day']) {
    const w = body[kind]
    if (!w || typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) continue
    limits.push({ kind, percentUsed: Math.max(0, Math.round(w.utilization * 10) / 10), resetsAt: typeof w.resets_at === 'string' ? w.resets_at : undefined })
  }
  if (limits.length === 0) throw new AskError('yanıtta limit yok')
  return limits
}

type Saved = { at: number; limits: Limit[] }
const isSaved = (v: unknown): v is Saved =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Saved).at === 'number' && Number.isFinite((v as Saved).at) && Array.isArray((v as Saved).limits)

// this chat's own reading from its replies, and when it last changed
let live: Saved | undefined

// the chat as Cetvel knows it: a hash of its id, never the id
let clientName: string | undefined
async function client($: EngineInterface): Promise<string> {
  if (clientName) return clientName
  const id = autoChat ?? (await chatId($))
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  clientName = `kota-bandi-${(h >>> 0).toString(36)}`
  return clientName
}

// kota-bandi is a fork of usage-quota: what that one's store held (each chat's auto
// compact, the learned pace, the last limits) is copied over once, never over a newer
// value. Read only: nothing here turns that mod on or off, or touches the settings.
const OLD_STORE = 'usage-quota_claude-code-usage-quota-mod-'
const MIGRATED_KEYS = /^(autoCompact:|pace$|limits$|planLimits$|calib$)/
async function migrateStore($: EngineInterface): Promise<void> {
  if (await keepGet($, 'migrated')) return
  try {
    const config = await configDir($)
    if (config) {
      const dir = `${config}/plugins/store`
      const old = (await $.fs.list(dir))
        .filter(f => f.kind === 'file' && f.name.startsWith(OLD_STORE) && f.name.endsWith('.json'))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
      if (old) {
        const parsed = JSON.parse(String(await $.fs.read(`${dir}/${old.name}`))) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!MIGRATED_KEYS.test(key)) continue
            if ((await keepGet($, key)) === undefined) await keepSet($, key, value)
          }
        }
      }
    }
  } catch (error) {
    $.ui.log(`kota-bandi: eski ayarlar kopyalanamadı: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
  await keepSet($, 'migrated', true)
}

// Three sources, and the newest wins: the usage service (asked seldom, shared by every
// chat), the figures each reply from Claude carries (this chat's, stamped when they
// last changed) and Cetvel's (any chat's, while it runs). A window that has reset since is dropped.
async function limitsOf(
  $: EngineInterface,
  rateLimits: SessionRateLimit[],
  now: number,
  ask: Ask,
): Promise<{ limits: Limit[]; at?: number; error?: string }> {
  if (rateLimits.length > 0) {
    const limits = rateLimits.map(r => ({
      kind: r.kind,
      percentUsed: Number.isFinite(r.percentUsed) ? Math.max(0, r.percentUsed) : 0,
      resetsAt: r.resetsAt,
    }))
    if (!live || JSON.stringify(live.limits) !== JSON.stringify(limits)) {
      live = { at: now, limits }
      cetvelSend('yanit_ratelimits', limits, await client($), now)
    }
  }
  const stored = await keepGet($, 'limits')
  let saved = isSaved(stored) ? stored : undefined
  const back = (await keepGet($, 'planBackoff')) as Backoff | undefined
  let backoff = back && typeof back.until === 'number' && Number.isFinite(back.until) ? back : undefined
  const asked = await keepGet($, 'planAskedAt')
  const askedAt = typeof asked === 'number' && Number.isFinite(asked) ? asked : 0
  const isFree = now >= (backoff?.until ?? 0)
  const isDue = ask === 'now' || (ask === 'due' && now - askedAt >= PLAN_EVERY_MS - PLAN_SLACK_MS)
  // with Cetvel running, one chat holds the 2-minute lease and asks; the rest read its
  // answer. A chat that has not looked at Cetvel yet (just opened: the exact count's
  // ask can come before the opening one) looks first, else its lease reads 'none'
  if (isDue && isFree && !cetvelLooked()) await cetvelLook($, now)
  if (isDue && isFree && (await cetvelLease($, await client($), now)) !== 'refused') {
    // claim the ask first, so the other chats see it taken and skip theirs
    await keepSet($, 'planAskedAt', now)
    try {
      const plan = await fetchPlan($)
      if (plan) {
        saved = { at: now, limits: plan }
        await keepSet($, 'limits', saved)
        await keepSet($, 'planLimits', saved)
        cetvelSend('oauth_usage', plan, await client($), now)
      }
      if (backoff) await keepSet($, 'planBackoff', { until: 0, failures: 0, error: '' })
      backoff = undefined
    } catch (error) {
      const failures = (backoff?.failures ?? 0) + 1
      const wait =
        error instanceof AskError && error.retryAfterMs !== undefined
          ? error.retryAfterMs
          : PLAN_BACKOFF_MS[Math.min(failures - 1, PLAN_BACKOFF_MS.length - 1)]!
      // the band says it in its own words; the engine's own goes to the debug log
      if (!(error instanceof AskError)) $.ui.log(`kota-bandi: kullanım sorusu: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
      backoff = { until: now + wait, failures, error: error instanceof AskError ? error.message : 'okunamadı' }
      await keepSet($, 'planBackoff', backoff)
    }
  }
  const shared = cetvelClaude(now)
  const sources = [saved, live, shared]
    .filter((r): r is Saved => r !== undefined)
    .sort((x, y) => y.at - x.at)
  const newest = sources[0]
  // a window the newest reading lacks (Cetvel fed by a status line with the 5 hour one
  // alone) is taken from the next newest that has it, never shown as not running
  const pick: Saved | undefined = newest && {
    at: newest.at,
    limits: [
      ...newest.limits,
      ...Object.keys(WINDOWS)
        .filter(kind => !newest.limits.some(l => l.kind === kind))
        .map(kind => sources.find(s => s.limits.some(l => l.kind === kind))?.limits.find(l => l.kind === kind))
        .filter((l): l is Limit => l !== undefined),
    ],
  }
  // newer reply figures go to the store too, so other chats get them
  if (live && newest === live && (!saved || live.at > saved.at)) await keepSet($, 'limits', live)
  // The reply figures run behind the usage service, which the app's panel reads: whole
  // percents, and seen at 18 for an hour while the service said 19.0. Use only climbs
  // within a window, so a newer reply figure below the service's last answer is stale:
  // the higher of the two is kept. Above it, the reply's is news.
  const planned = await keepGet($, 'planLimits')
  const plan = isSaved(planned) ? planned : undefined
  const finer = (l: Limit): Limit => {
    const pct = Number.isFinite(l.percentUsed) ? Math.max(0, l.percentUsed) : 0
    const p = plan?.limits.find(x => x.kind === l.kind)
    return p && sameWindow(p.resetsAt, l.resetsAt) && Number.isFinite(p.percentUsed) && p.percentUsed > pct
      ? { ...l, percentUsed: p.percentUsed }
      : { ...l, percentUsed: pct }
  }
  // a window that has reset (or holds an unparseable reset) stays, at 0: the forecast reads it as not running
  const limits = (pick?.limits ?? []).map(l => {
    const resetMs = l.resetsAt !== undefined ? Date.parse(l.resetsAt) : NaN
    return l.resetsAt !== undefined && (!Number.isFinite(resetMs) || resetMs <= now) ? { kind: l.kind, percentUsed: 0 } : finer(l)
  })
  return { limits, at: pick?.at, error: backoff?.error || undefined }
}

// What the forecast learns, shared by every chat: how far each past window got (its
// peak, the last few kept), and the running one's peak and skipped %.
type PaceWindow = { resetsAt: number; peak: number; skip: number }
type PaceStore = { finals: Record<string, number[]>; windows: Record<string, PaceWindow> }
const TYPICAL_DEFAULT = 50
const FINALS_KEPT = 8
// one window's reset time as two readings give it: a few minutes apart at most
const SAME_WINDOW_MS = 10 * 60_000

// A chat reopened with a long history re-reads it all on its first reply: one big jump
// in usage. Its first turn notes the limits it started from; the first new reading
// that moved is that jump, and is left out of the pace. Only for a chat that opened
// with this much already in it (a new chat's first reply is real work).
const RESUME_MIN_TOKENS = 20_000
let openMessages = 0
// opening until this chat's first main turn starts (the `opening` state, which a reload keeps)
async function isOpeningNow($: EngineInterface): Promise<boolean> {
  const op = await read($, opening)
  return !op.done || op.chat !== (autoChat ?? (await chatId($)))
}
let spikeFrom: { at: number; limits: Limit[] } | undefined

function median(list: number[] | undefined): number | undefined {
  if (!list || list.length === 0) return undefined
  const s = list.filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b)
  if (s.length === 0) return undefined
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const sameWindow = (a: string | undefined, b: string | undefined) => {
  if (a === undefined || b === undefined) return false
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= SAME_WINDOW_MS
}

// the jump the reopened chat's first reply made, once a reading after it has moved
function takeSpike(): Record<string, number> | undefined {
  if (!spikeFrom || !live || live.at <= spikeFrom.at) return undefined
  const jump: Record<string, number> = {}
  for (const l of live.limits) {
    const before = spikeFrom.limits.find(b => b.kind === l.kind)
    if (before && sameWindow(before.resetsAt, l.resetsAt) && Number.isFinite(l.percentUsed) && Number.isFinite(before.percentUsed) && l.percentUsed > before.percentUsed) {
      jump[l.kind] = l.percentUsed - before.percentUsed
    }
  }
  if (Object.keys(jump).length === 0) return undefined
  spikeFrom = undefined
  return jump
}

function paceStore(v: unknown): PaceStore {
  const p = v as PaceStore | undefined
  return p && typeof p === 'object' && !Array.isArray(p) && p.finals && typeof p.finals === 'object' && p.windows && typeof p.windows === 'object'
    ? p
    : { finals: {}, windows: {} }
}

async function trackPace($: EngineInterface, limits: Limit[], now: number): Promise<Record<string, PaceOf>> {
  const spike = takeSpike()
  const saved = paceStore(await keepGet($, 'pace'))
  let isChanged = false
  const pace: Record<string, PaceOf> = {}
  for (const l of limits) {
    const resetsAt = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    if (!WINDOWS[l.kind] || !Number.isFinite(resetsAt) || resetsAt <= now) continue
    const used = Number.isFinite(l.percentUsed) ? Math.max(0, l.percentUsed) : 0
    let w = saved.windows[l.kind]
    if (!w || !Number.isFinite(w.resetsAt) || Math.abs(w.resetsAt - resetsAt) > SAME_WINDOW_MS) {
      // a new window: the last one's peak is how far it got
      if (w && Number.isFinite(w.peak) && w.peak > 0) saved.finals[l.kind] = [...(saved.finals[l.kind] ?? []), w.peak].slice(-FINALS_KEPT)
      w = { resetsAt, peak: used, skip: 0 }
      saved.windows[l.kind] = w
      isChanged = true
    } else if (used > w.peak) {
      w.peak = used
      isChanged = true
    }
    const jump = spike?.[l.kind]
    if (jump) {
      w.skip = Math.min(w.peak, (Number.isFinite(w.skip) ? w.skip : 0) + jump)
      isChanged = true
    }
    const finals = saved.finals[l.kind]
    pace[l.kind] = { typical: median(finals) ?? TYPICAL_DEFAULT, skip: Number.isFinite(w.skip) ? w.skip : 0, n: finals?.length ?? 0 }
  }
  if (isChanged) await keepSet($, 'pace', saved)
  return pace
}

// An early warning toasts once a window: in one chat, the rest see it was said
const warned = new Set<string>()
async function warnEarly($: EngineInterface, limits: Limit[], pace: Record<string, PaceOf>, ewma: Record<string, Ewma>, now: number): Promise<void> {
  for (const l of limits) {
    const f = forecast(l, now, pace[l.kind], ewma[l.kind])
    if (!f || !isEarly(f)) continue
    const key = `${f.kind}:${Math.round(f.resetsAt / 60_000)}`
    if (warned.has(key)) continue
    warned.add(key)
    const rawSaid = await keepGet($, 'earlyWarned')
    const said = rawSaid && typeof rawSaid === 'object' && !Array.isArray(rawSaid) ? (rawSaid as Record<string, number>) : {}
    if (said[key]) continue
    const fresh = Object.fromEntries(Object.entries(said).filter(([, t]) => typeof t === 'number' && Number.isFinite(t) && now - t < 8 * 24 * 3_600_000))
    await keepSet($, 'earlyWarned', { ...fresh, [key]: now })
    $.ui.toast(earlyText(f, now))
  }
}

// The window is shown as three groups: Messages, Tools (System + MCP tools) and Other
// (the system prompt, skills, memory files, agents, MCP server instructions).
const TOOL_NAMES = new Set(['System tools', 'MCP tools'])
type Group = 'Messages' | 'Tools' | 'Other'
const groupOf = (name: string): Group => (name === 'Messages' ? 'Messages' : TOOL_NAMES.has(name) ? 'Tools' : 'Other')

// The free local breakdown ('summary') estimates each category from its text, which
// reads tools ~1.3-1.6x heavy. The exact count ('full', what /context and the app's
// Context window panel show) costs no tokens but sends one token-count request per tool
// and memory file (~320 here). So it runs every 2 minutes in one chat of all: the
// exact/estimate ratio of Tools and Other is kept for every chat (with when it was
// counted), and a chat that finds it fresh takes it instead of counting again.
const CALIBRATE_EVERY_MS = 2 * 60_000
type Calib = Partial<Record<Group, number>> & { t?: number }
let calib: Partial<Record<Group, number>> = {}
let isCalibrating = false
// Right after /compact there is no API reply yet, so the window's real total is unknown
// and the local estimate is all there is. The exact count fills that gap until the next reply.
let exactCount: { at: number; sums: Record<Group, number> } | undefined
let noReplySince: number | undefined

function ratiosOf(v: unknown): Partial<Record<Group, number>> {
  const c = v && typeof v === 'object' && !Array.isArray(v) ? (v as Calib) : ({} as Calib)
  const out: Partial<Record<Group, number>> = {}
  for (const g of ['Tools', 'Other'] as const) {
    const r = c[g]
    if (typeof r === 'number' && Number.isFinite(r) && r > 0 && r < 100) out[g] = r
  }
  return out
}

function sumGroups(categories: readonly { name: string; tokens: number; kind: string }[]): Record<Group, number> {
  const sums: Record<Group, number> = { Messages: 0, Tools: 0, Other: 0 }
  for (const c of categories) {
    if (c.kind === 'used' && Number.isFinite(c.tokens) && c.tokens > 0) sums[groupOf(c.name)] += c.tokens
  }
  return sums
}

/** `exact`: this chat needs its own count (no reply since a compaction), not just the ratio. */
async function calibrate($: EngineInterface, exact = false): Promise<void> {
  if (isCalibrating) return
  const now = await $.clock.now()
  const shared = (await keepGet($, 'calib')) as Calib | undefined
  if (!exact && typeof shared?.t === 'number' && Number.isFinite(shared.t) && now - shared.t < CALIBRATE_EVERY_MS - PLAN_SLACK_MS) {
    calib = ratiosOf(shared)
  } else {
    isCalibrating = true
    try {
      const full = await $.session.usage({ breakdown: 'full' })
      const rough = await $.session.usage({ breakdown: 'summary' })
      const real = sumGroups(full.context.breakdown?.categories ?? [])
      const guess = sumGroups(rough.context.breakdown?.categories ?? [])
      const next = { ...calib }
      for (const g of ['Tools', 'Other'] as const) if (guess[g] > 0 && real[g] > 0) next[g] = real[g] / guess[g]
      calib = next
      exactCount = { at: await $.clock.now(), sums: real }
      await keepSet($, 'calib', { ...next, t: now })
    } catch (error) {
      $.ui.log(`kota-bandi: kesin sayım başarısız: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    } finally {
      isCalibrating = false
    }
  }
  lastSnapshot = ''
  // the usage service is asked alongside, on the same 2 minutes
  await refresh($, 'due')
}

// Auto compact fires whenever the chat is idle (no turn running) and the context
// is at or past the %: at the end of a turn, on opening a chat, on any refresh between
// turns. Held back only by: `waits` (the band is asking, or the person chose
// "after my next compact", which is also what an unanswered ask means: cleared only by
// a real compaction, never by the % flickering below), `stuck` (a compaction already ran,
// or could not start, and the context is still past the %: it would only repeat;
// dropping below clears it). The % is compared as the band shows it, rounded.
let hadReply = false
async function setHold($: EngineInterface, patch: Partial<Hold>): Promise<void> {
  await update($, hold, held => ({ ...held, ...patch }))
}
let isBusy = false
let isCompacting = false
let lastPercent = 0

function compactNow($: EngineInterface): void {
  if (isCompacting) return
  isCompacting = true
  // compacting takes longer than a press or a hook may run, so a timer starts it
  $.clock.after(0, async () => {
    try {
      await $.command.run({ command: 'compact' })
    } catch (error) {
      // said in the band's words; the engine's own goes to the debug log
      $.ui.toast(isBusy ? 'Sıkıştırma başlatılamadı: yanıt sürüyor. Yanıt bitince yeniden deneyin.' : 'Sıkıştırma başlatılamadı. Birkaç saniye sonra yeniden deneyin.')
      $.ui.log(`kota-bandi: sıkıştırma başlatılamadı: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    } finally {
      isCompacting = false
    }
  })
}

// Auto compact compacts through the session itself, not by typing /compact: a
// command run from the end of a turn is refused while the turn winds down. The
// compaction also rejects while a turn runs, so it is tried again a few times, a
// couple of seconds apart; after the last it holds (stuck) instead of starting over.
// The desktop app (an SDK session) has no direct compaction: there /compact runs as a
// turn of its own, so it is typed, as the Compact button does. Which way works is
// learnt from a compaction that started, never from one refusal: a refusal of one way
// tries the other next, and only "direct refused, typed started" settles on typing.
const AUTO_TRIES = 6
let canCompactDirectly = true
const AUTO_RETRY_MS = 2_000
type Way = 'direct' | 'typed'

function autoCompactNow($: EngineInterface, attempt = 1, way: Way = canCompactDirectly ? 'direct' : 'typed', wasDirectRefused = false): void {
  if (attempt === 1) {
    if (isCompacting) return
    isCompacting = true
  }
  $.clock.after(attempt === 1 ? 1_000 : AUTO_RETRY_MS, async () => {
    // a main turn started meanwhile: never mid-reply; its end (watchAuto) starts it again
    if (isBusy) {
      isCompacting = false
      $.ui.log('kota-bandi: otomatik sıkıştırma ertelendi: yanıt sürüyor', { to: 'debug' })
      return
    }
    let result: Awaited<ReturnType<EngineInterface['session']['compact']>> | undefined
    try {
      result = way === 'direct' ? await $.session.compact() : (await $.command.run({ command: 'compact' }), undefined)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const isDirectRefused = wasDirectRefused || way === 'direct'
      if (attempt < AUTO_TRIES) {
        // where typing is known to be the way, it stays; else the other way next
        const nextWay: Way = !canCompactDirectly ? 'typed' : way === 'direct' ? 'typed' : 'direct'
        return autoCompactNow($, attempt + 1, nextWay, isDirectRefused)
      }
      isCompacting = false
      // nothing learnt from a run of refusals: the next time starts with the direct way
      canCompactDirectly = true
      // held, not tried again every 3 s: until the context drops below the % or the
      // person compacts with the button
      await setHold($, { stuck: true })
      $.ui.toast(`Otomatik sıkıştırma ${AUTO_TRIES} denemede başlatılamadı; bağlam eşiğin altına inene kadar yeniden denenmez. Sıkıştır düğmesiyle elle başlatabilirsiniz.`)
      $.ui.log(`kota-bandi: otomatik sıkıştırma başarısız: ${reason}`, { to: 'debug' })
      return
    }
    // it started: which way works here is known now
    if (way === 'direct') canCompactDirectly = true
    else if (wasDirectRefused) canCompactDirectly = false
    isCompacting = false
    // From here on the compaction stands: a failed read after it is logged, never taken
    // for a compaction that did not start (that started a second one)
    try {
      // held as stuck while the figures are read again, so no tick fires a second one
      await setHold($, { stuck: true })
      if (result && 'skip' in result && result.skip) {
        $.ui.toast('Otomatik sıkıştırma atlandı')
        $.ui.log(`kota-bandi: sıkıştırma atlandı: ${result.skip}`, { to: 'debug' })
      }
      lastSnapshot = ''
      const usage = await $.session.usage({ breakdown: 'summary' })
      const rawPct = usage.context.percent
      const percent = typeof rawPct === 'number' && Number.isFinite(rawPct) ? rawPct : 0
      // still past the % after compacting: say so once, and do not loop on it
      const auto = await read($, autoCompact)
      if (auto.at !== null && Math.round(percent) >= auto.at) {
        $.ui.toast(`Sıkıştırmadan sonra bağlam hâlâ %${Math.round(percent)}, eşik %${auto.at}: bağlam eşiğin altına inene kadar otomatik sıkıştırma bekler`)
      } else await setHold($, { stuck: false })
      await refresh($)
    } catch (error) {
      // still held as stuck: the next reading below the % clears it
      $.ui.log(`kota-bandi: sıkıştırma sonrası okuma: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    }
  })
}

// called with the context % whenever it is read
async function watchAuto($: EngineInterface, percent: number): Promise<void> {
  const pct = Number.isFinite(percent) ? percent : 0
  lastPercent = pct
  const auto = await read($, autoCompact)
  if (!auto.isOn || auto.at === null || !Number.isFinite(auto.at)) return
  const held = await read($, hold)
  if (Math.round(pct) < auto.at) {
    if (held.stuck) await setHold($, { stuck: false })
    return
  }
  if (held.waits || held.stuck || isBusy || isCompacting) return
  $.ui.toast(`Bağlam %${Math.round(pct)}: otomatik sıkıştırılıyor (eşik %${auto.at})`)
  autoCompactNow($)
}

// `kaynak`: a press sets it by hand; a /clear carrying the old chat's on keeps who set that.
// Kept with the setting (the store's `kaynak`, the shared file's `t`: 0 for a default),
// so a later default can move one the band set, never one a person chose.
async function saveAuto($: EngineInterface, next: AutoCompact, kaynak: Source = BY_HAND): Promise<void> {
  await update($, autoCompact, () => next)
  const id = autoChat ?? (await chatId($))
  autoSource = kaynak
  await keepSet($, `autoCompact:${id}`, { isOn: next.isOn, at: next.at, kaynak })
  // shared with piksel-ofis, which sets it from its pane too
  const t = kaynak === BY_HAND ? await $.clock.now() : 0
  sharedSeen = Math.max(sharedSeen, t)
  await writeShared($, id, { isOn: next.isOn, at: next.at ?? AT_DEFAULT, t })
}

// a change made from piksel-ofis's pane: taken over, then saved as this band's own
let sharedSeen = 0
let beatAt = 0
async function syncShared($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  // says this band is here: piksel-ofis then leaves running auto compact to it
  if (now - beatAt >= 5_000) {
    beatAt = now
    await beat($, 'kota-bandi', now)
  }
  const id = autoChat ?? (await chatId($))
  const shared = await readShared($, id)
  if (!shared || shared.t <= sharedSeen) return
  sharedSeen = shared.t
  const auto = await read($, autoCompact)
  if (auto.isOn === shared.isOn && auto.at === shared.at) return
  await update($, autoCompact, () => ({ isOn: shared.isOn, at: shared.at }))
  // a newer shared record is a press in piksel-ofis's pane: set by hand
  autoSource = BY_HAND
  await keepSet($, `autoCompact:${id}`, { isOn: shared.isOn, at: shared.at, kaynak: BY_HAND })
  if (shared.isOn) await askIfPast($, shared.at)
  else await update($, autoAsk, () => null)
}

// Auto compact is set per chat: a new chat opens with it on at the default %; a chat
// reopened, or the app restarted, gets back its own (the shared file first, which
// piksel-ofis writes too); after /clear the chat goes on under a new id, unannounced,
// and keeps what the old one had.
let autoChat: string | undefined
// when the session will not say its id: one of this process's own, never one shared by every chat
let ownId: string | undefined
async function chatId($: EngineInterface): Promise<string> {
  try {
    return await $.session.id()
  } catch {
    ownId ??= `sohbet-${Math.random().toString(36).slice(2, 10)}`
    return ownId
  }
}
// who set this chat's setting: what a /clear carries over to the next id
let autoSource: Source = BY_DEFAULT
// the one pass raising old defaults (esik.ts), started by the first load of this module
let defaultsRaised: Promise<number> | undefined
async function loadAuto($: EngineInterface): Promise<void> {
  const id = await chatId($)
  if (id === autoChat) return
  // before any chat's setting is read: what was kept may move to the new default
  defaultsRaised ??= raiseDefaults($).catch(() => 0)
  await defaultsRaised
  if (id === autoChat) return
  const previous = autoChat
  const wasSource = autoSource
  const was = await read($, autoCompact)
  autoChat = id
  clientName = undefined
  const shared = await readShared($, id)
  const saved = storedOf(await keepGet($, `autoCompact:${id}`))
  // a /clear in this process: the new id has nothing yet, so the old chat's setting goes on
  const isCarried = previous !== undefined && !saved && !(shared && shared.t > 0)
  const isShared = !!shared && (shared.t > 0 || !saved)
  const next: AutoCompact =
    isShared
      ? { isOn: shared!.isOn, at: shared!.at }
      : saved
        ? { isOn: saved.isOn, at: saved.at ?? AT_DEFAULT }
        : isCarried
          ? { isOn: was.isOn, at: was.at ?? AT_DEFAULT }
          : { isOn: true, at: AT_DEFAULT }
  // who set it, read as the pass in esik.ts reads it: a store record from before `kaynak`
  // was a press, and a shared `t` 0 is a default only at a default %
  autoSource = isShared
    ? sharedSource(shared!)
    : saved
      ? storedSource(saved)
      : isCarried
        ? wasSource
        : BY_DEFAULT
  await update($, autoCompact, () => next)
  sharedSeen = shared?.t ?? 0
  if (isCarried) await saveAuto($, next, wasSource)
  else if (!shared) await writeShared($, id, { isOn: next.isOn, at: next.at ?? AT_DEFAULT, t: 0 })
  // the same chat after a reload keeps its ask and what holds it back
  if ((await read($, hold)).chat === id) return
  await update($, hold, () => ({ chat: id, waits: false, stuck: false }))
  await update($, autoAsk, () => null)
}

// the % is set with two buttons, 5 points a press, 15 to 95: no text field, whose
// chrome the band had to clip and which then showed one digit of two on the desktop
const AT_MIN = 15
// the % whenever there is none (a first switch-on) is AT_DEFAULT, from esik.ts
const AT_MAX = 95
const AT_STEP = 5

async function stepAt($: EngineInterface, by: number): Promise<void> {
  const was = (await read($, autoCompact)).at ?? AT_DEFAULT
  const at = Math.min(AT_MAX, Math.max(AT_MIN, Math.round((was + by) / AT_STEP) * AT_STEP))
  if (at !== was) await setThreshold($, at)
}

// a new threshold: armed when the context is below it, else the band asks, in its
// own buttons (never the chat's question dialog, which runs through the chat)
async function setThreshold($: EngineInterface, at: number): Promise<void> {
  await saveAuto($, { isOn: true, at })
  await askIfPast($, at)
}

// the switch, from the state at the press (never a closure of an older draw's)
async function toggleAuto($: EngineInterface): Promise<void> {
  const auto = await read($, autoCompact)
  const flipped = { isOn: !auto.isOn, at: auto.at ?? AT_DEFAULT }
  await saveAuto($, flipped)
  if (flipped.isOn) await askIfPast($, flipped.at)
  else await update($, autoAsk, () => null)
}

// turning it on, or a new %, while the context is already past it: ask first
async function askIfPast($: EngineInterface, at: number | null): Promise<void> {
  const cur = Number.isFinite(lastPercent) ? Math.round(lastPercent) : 0
  const isPast = at !== null && Number.isFinite(at) && cur >= at
  await setHold($, { waits: isPast, stuck: false })
  await update($, autoAsk, () => (isPast ? { at: at!, percent: cur } : null))
  if (!isPast && at !== null && Number.isFinite(at)) $.ui.toast(`Otomatik sıkıştırma: bağlam %${at} olunca`)
}

type AskChoice = 'now' | 'next'

const askLine = (ask: { at: number; percent: number }) =>
  `Bağlam zaten %${ask.percent}, eşik olan %${ask.at} aşıldı. Otomatik sıkıştırma:`

// the context's three groups as the band names them
const GROUP_TR: Record<string, string> = { Messages: 'Mesajlar', Tools: 'Araçlar', Other: 'Diğer' }

async function answerAsk($: EngineInterface, choice: AskChoice): Promise<void> {
  await update($, autoAsk, () => null)
  // 'next': goes on waiting until a compaction is seen (the reply total goes blank)
  if (choice === 'now') {
    await setHold($, { waits: false })
    autoCompactNow($)
  }
}

// The band's mode (detailed, short, hidden) is one setting for every chat, kept with
// the time it was set. Each chat looks every 1.5 s and takes a setting only when it is
// newer than any it has seen or made: a press is never undone by an older (or failed)
// read, which is what reopened the band by itself when the store could not be written.
type ViewRecord = View & { t: number }
const VIEW_EVERY_MS = 1_500
let viewSeen = 0
let isViewMigrated = false
const MODES: readonly Mode[] = ['detayli', 'kisa', 'gizli']
function viewRecordOf(v: unknown): ViewRecord | undefined {
  const r = v as ViewRecord | undefined
  if (!r || typeof r !== 'object' || Array.isArray(r) || !MODES.includes(r.mode) || typeof r.t !== 'number' || !Number.isFinite(r.t)) return undefined
  return { mode: r.mode, last: r.last === 'kisa' ? 'kisa' : 'detayli', t: r.t }
}
async function syncView($: EngineInterface): Promise<void> {
  let record = viewRecordOf(await keepGet($, 'view'))
  if (!record && !isViewMigrated) {
    // 0.3's ▼: the band was collapsed for every chat
    isViewMigrated = true
    if ((await keepGet($, 'collapsed')) === true) {
      record = { mode: 'kisa', last: 'kisa', t: 1 }
      await keepSet($, 'view', record)
    }
  }
  if (!record || record.t <= viewSeen) return
  viewSeen = record.t
  const now = await read($, view)
  if (now.mode !== record.mode || now.last !== record.last) await update($, view, () => ({ mode: record!.mode, last: record!.last }))
}
async function setMode($: EngineInterface, mode: Mode): Promise<void> {
  const was = await read($, view)
  const last = mode === 'gizli' ? was.last : mode
  const t = Math.max(await $.clock.now(), viewSeen + 1)
  // seen first: a look already under way finds it older and leaves it
  viewSeen = t
  await update($, view, () => ({ mode, last }))
  await keepSet($, 'view', { mode, last, t })
}

// The original usage-quota mod beside this one draws a second band and runs its own
// auto compact (unaware of the shared file) and plan questions. Looked for once a
// minute: on in the settings, or (off there, but still loaded in a chat opened before)
// its store written in the last 10 minutes. Only read: the band never turns it off itself.
const ORIGINAL_EVERY_MS = 60_000
const ORIGINAL_LIVE_MS = 10 * 60_000
const ORIGINAL_ID = 'usage-quota@claude-code-usage-quota-mod'
async function checkOriginal($: EngineInterface): Promise<void> {
  let next: Original = { state: 'none', id: '' }
  let id = ''
  try {
    const raw = (await $.settings.read({ key: 'enabledPlugins' })) as Record<string, unknown> | undefined
    // the key's value; a whole settings object holds it under its name
    const plugins = raw && typeof raw === 'object' && raw.enabledPlugins && typeof raw.enabledPlugins === 'object' ? raw.enabledPlugins : raw
    if (plugins && typeof plugins === 'object') {
      for (const [key, value] of Object.entries(plugins as Record<string, unknown>)) {
        if (!/^usage-quota@/.test(key)) continue
        id = key
        if (value === true) next = { state: 'enabled', id: key }
      }
    }
  } catch {
    // no settings to read: the store's file says enough
  }
  if (next.state === 'none') {
    try {
      const config = await configDir($)
      const now = await $.clock.now()
      if (config) {
        const files = await $.fs.list(`${config}/plugins/store`)
        const store = files.find(f => f.kind === 'file' && f.name.startsWith('usage-quota_') && now - f.mtimeMs < ORIGINAL_LIVE_MS)
        if (store) next = { state: 'live', id: id || ORIGINAL_ID }
      }
    } catch {
      // nothing to list
    }
  }
  const was = await read($, original)
  if (was.state !== next.state || was.id !== next.id) await update($, original, () => next)
}

function originalLine(o: Original): string | undefined {
  if (o.state === 'none') return undefined
  const id = o.id || ORIGINAL_ID
  return o.state === 'enabled'
    ? `İki kota bandı açık: özgün usage-quota modunu kapatın. Kalıcı yol: terminalde "claude plugin uninstall ${id}", sonra açık sohbetlerde /reload-plugins.`
    : `İki kota bandı açık: özgün usage-quota ayarda kapalı ama açık bir sohbette hâlâ yüklü. Açık sohbetlerde /reload-plugins yapın; kalıcı için terminalde "claude plugin uninstall ${id}".`
}

// Cetvel on a timer of its own, never in the band's 3s tick: a slow service never holds the band
const CETVEL_EVERY_MS = 5_000
// a chat's first ask: 1 s after it opens, plus up to 2 s more at random
const OPEN_ASK_MIN_MS = 1_000
const OPEN_ASK_SPREAD_MS = 2_000
let othersJson = 'null'
async function cetvelTick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await cetvelLook($, now)
  await syncOthers($, now)
}
async function syncOthers($: EngineInterface, now: number): Promise<void> {
  const next = cetvelView(now)
  const json = JSON.stringify(next)
  if (json === othersJson) return
  othersJson = json
  await update($, others, () => next)
}

let isRefreshing = false
// an ask that arrived while a 3s tick was running: done right after it, not dropped
let pendingAsk: Ask = 'no'
let lastSnapshot = ''
let hadError = false

async function refresh($: EngineInterface, ask: Ask = 'no'): Promise<void> {
  await loadAuto($)
  await syncShared($)
  if (isRefreshing) {
    if (ask === 'now' || (ask === 'due' && pendingAsk === 'no')) pendingAsk = ask
    return
  }
  isRefreshing = true
  try {
    const now = await $.clock.now()
    const usage = await $.session.usage({ breakdown: 'summary' })
    const { context } = usage
    const winSize = typeof context.window === 'number' && Number.isFinite(context.window) && context.window > 0 ? context.window : 0
    const ctxTokens = typeof context.tokens === 'number' && Number.isFinite(context.tokens) ? Math.max(0, context.tokens) : undefined
    const breakdown = context.breakdown
    const all = (breakdown?.categories ?? []).filter(c => c.kind !== 'deferred' && typeof c.tokens === 'number' && Number.isFinite(c.tokens) && c.tokens > 0)
    const rough = sumGroups(all)
    if (ctxTokens === undefined) {
      // no reply since the chat opened or was compacted: get the exact count once
      if (noReplySince === undefined) {
        noReplySince = now
        $.clock.after(0, () => void calibrate($, true))
      }
    } else noReplySince = undefined
    // what the chat opened with, before its first turn here (a reopened chat may
    // already carry its last reply's total, so not only while that is blank)
    if (await isOpeningNow($)) openMessages = Math.max(rough.Messages, ctxTokens ?? 0)
    // the reply total going blank after a reply: the chat was compacted (or cleared)
    if (ctxTokens !== undefined) hadReply = true
    else if (hadReply) {
      hadReply = false
      // an ask left unanswered meant "after my next compact": done with now
      if ((await read($, hold)).waits) {
        await update($, autoAsk, () => null)
        await setHold($, { waits: false })
      }
    }
    const useExact = ctxTokens === undefined && exactCount !== undefined && noReplySince !== undefined && exactCount.at >= noReplySince
    let tools = Math.round(rough.Tools * (calib.Tools ?? 1))
    let other = Math.round(rough.Other * (calib.Other ?? 1))
    // Messages is what the window holds beyond everything else, as /context counts it:
    // the API's real input total less the other groups, not the local estimate
    let messages = ctxTokens !== undefined && ctxTokens - tools - other > 0 ? ctxTokens - tools - other : rough.Messages
    if (useExact) ({ Messages: messages, Tools: tools, Other: other } = exactCount!.sums)
    const rawTotal = typeof breakdown?.totalTokens === 'number' && Number.isFinite(breakdown.totalTokens) ? Math.max(0, breakdown.totalTokens) : 0
    const used = ctxTokens ?? (useExact ? messages + tools + other : rawTotal)
    const categories: Category[] = [
      { name: 'Messages', tokens: Math.max(0, messages), kind: 'used' as const },
      { name: 'Tools', tokens: Math.max(0, tools), kind: 'used' as const },
      { name: 'Other', tokens: Math.max(0, other), kind: 'used' as const },
      ...all
        .filter(c => c.kind === 'buffer' || c.kind === 'free')
        .map(c => ({ name: c.name, tokens: Math.max(0, c.tokens), kind: c.kind as Category['kind'] })),
    ].filter(c => c.tokens > 0)
    const { limits, at: limitsAt, error: limitsError } = await limitsOf($, usage.rateLimits, now, ask)
    const pace = await trackPace($, limits, now)
    // Cetvel's EWMA pace, for the windows it has one for (forecast() checks the reset matches)
    const ewma = Object.fromEntries(Object.entries(cetvelEwma(now) ?? {}).filter(([kind]) => limits.some(l => l.kind === kind)))
    await warnEarly($, limits, pace, ewma, now)
    const computedPct = winSize > 0 ? Math.round((used / winSize) * 100) : 0
    const rawCtxPct = typeof context.percent === 'number' && Number.isFinite(context.percent) ? context.percent : undefined
    const rawBrkPct = typeof breakdown?.percentage === 'number' && Number.isFinite(breakdown.percentage) ? breakdown.percentage : undefined
    const percent = Math.max(0, useExact ? computedPct : rawCtxPct ?? rawBrkPct ?? computedPct)
    const next: Snapshot = {
      window: winSize,
      tokens: used,
      percent,
      total: categories.reduce((sum, c) => sum + c.tokens, 0) || winSize,
      categories,
      limits,
      ...(limitsAt !== undefined ? { limitsAt } : {}),
      ...(limitsError ? { limitsError } : {}),
      ...(Object.keys(pace).length > 0 ? { pace } : {}),
      ...(Object.keys(ewma).length > 0 ? { ewma } : {}),
      // the minute, so countdowns and ages redraw even when nothing else moves
      minute: Math.floor(now / 60_000),
    }
    await watchAuto($, next.percent)
    // redraw only when something moved, not on every tick
    const json = JSON.stringify(next)
    if (json !== lastSnapshot) {
      lastSnapshot = json
      await update($, snapshot, () => next)
    }
    await syncOthers($, now)
    if (hadError) $.ui.status(undefined)
    hadError = false
  } catch (error) {
    $.ui.log(`kota-bandi: yenileme: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    $.ui.status('kota-bandi: kullanım okunamadı, birkaç saniye içinde yeniden denenecek')
    hadError = true
  } finally {
    isRefreshing = false
  }
  if (pendingAsk !== 'no') {
    const queued = pendingAsk
    pendingAsk = 'no'
    await refresh($, queued)
  }
}

// The forecasts a draw shows, worked out once a minute for a reading, not on every draw
let memo: { key: string; list: Forecast[] } | undefined
function forecastsOf(snap: Snapshot, now: number): Forecast[] {
  const rawLimits = Array.isArray(snap.limits) ? snap.limits : []
  const key = `${Math.floor(now / 60_000)}|${JSON.stringify(rawLimits)}|${JSON.stringify(snap.pace ?? {})}|${JSON.stringify(snap.ewma ?? {})}`
  if (memo?.key === key) return memo.list
  // both windows always, once there is any reading: one the reading lacks is not running
  const known = rawLimits.length === 0 ? [] : Object.keys(WINDOWS).map(kind => rawLimits.find(l => l.kind === kind) ?? { kind, percentUsed: 0 })
  const list = known.map(l => forecast(l, now, snap.pace?.[l.kind], snap.ewma?.[l.kind])).filter((f): f is Forecast => f !== null)
  memo = { key, list }
  return list
}

const MODE_WORDS: Record<string, Mode> = { detayli: 'detayli', 'detaylı': 'detayli', kisa: 'kisa', 'kısa': 'kisa', gizli: 'gizli' }
const MODE_TR: Record<Mode, string> = { detayli: 'detaylı', kisa: 'kısa', gizli: 'gizli' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'kota',
      description: 'Kota bandını açar ya da kapatır; "detaylı", "kısa" ya da "gizli" ile görünümünü seçer',
      argumentHint: '[detaylı|kısa|gizli]',
    })
    const result = await next(e)
    const now = await $.clock.now()
    viewSeen = 0
    isViewMigrated = false
    cetvelReset()
    othersJson = 'null'
    whenBroken(() => {
      $.ui.toast('Kota bandı: ayar deposu bozuk; ayarlar yedek dosyalarda tutuluyor (plugins/data/kota-bandi). Onarım için README\'deki "Depo bozulursa" adımına bakın.')
      $.ui.log('kota-bandi: ayar deposu okunup yazılamıyor; yedek dosyalara geçildi', { to: 'debug' })
    })
    await probeStore($, now)
    await migrateStore($)
    calib = ratiosOf(await keepGet($, 'calib'))
    const isShown = await keepGet($, 'bandOn')
    if (typeof isShown === 'boolean') await update($, isOn, () => isShown)
    await loadAuto($)
    await syncView($)
    await checkOriginal($)
    // what this chat already holds, at once; the usage service is asked a moment later
    await refresh($)
    // A chat just opened asks for its limits, unless another chat asked a moment ago:
    // after one look at Cetvel (its lease is unknown before it, so every chat opening
    // with the app would ask), and at a spread of 1-3 s, so chats opening together do
    // not all read "not asked yet" at once
    $.clock.after(OPEN_ASK_MIN_MS + Math.floor(Math.random() * OPEN_ASK_SPREAD_MS), async () => {
      await cetvelTick($)
      await refresh($, 'due')
    })
    // the exact count on a timer, never from the hook itself: work a hook starts and
    // leaves running ends with its dispatch, which is why it never ran before
    $.clock.after(2_000, () => void calibrate($))
    $.clock.every(CALIBRATE_EVERY_MS, () => void calibrate($))
    // keep it live, mid-turn included: what Claude Code already holds (the context and
    // the limits each reply carries), every 3s; timers stop when the module reloads
    $.clock.every(LOCAL_EVERY_MS, () => void refresh($))
    $.clock.every(VIEW_EVERY_MS, () => void syncView($))
    $.clock.every(ORIGINAL_EVERY_MS, () => void checkOriginal($))
    $.clock.every(CETVEL_EVERY_MS, () => void cetvelTick($))
    // a broken store is tried again every 5 minutes: repaired, the band goes back to it
    $.clock.every(5 * 60_000, async () => {
      if (storeHealth() === 'broken') await probeStore($, await $.clock.now())
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  // Both hear every loop's turns, a subagent's too (`agentId`): only the main loop's
  // say whether a reply is running, start the opening, or end it
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    isBusy = true
    if (await isOpeningNow($)) {
      const id = autoChat ?? (await chatId($))
      await update($, opening, () => ({ chat: id, done: true }))
      const snap = await read($, snapshot)
      if (snap && snap.limits.length > 0 && openMessages >= RESUME_MIN_TOKENS) {
        spikeFrom = { at: await $.clock.now(), limits: snap.limits }
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const result = await next(e)
    await refresh($)
    // the first reply is done: whatever it used, the jump is behind it
    spikeFrom = undefined
    // the turn is over: auto compact may fire now, never mid-reply
    isBusy = false
    const snap = await read($, snapshot)
    if (snap) await watchAuto($, snap.percent)
    return result
  })

  on('command.run', { command: 'kota' }, async ($, e) => {
    const word = (e.args ?? '').trim().toLocaleLowerCase('tr-TR')
    if (word) {
      // own keys only: "constructor" or "toString" is no mode
      const mode = Object.prototype.hasOwnProperty.call(MODE_WORDS, word) ? MODE_WORDS[word] : undefined
      if (!mode) return { text: 'Kullanım: /kota (aç/kapat), /kota detaylı, /kota kısa ya da /kota gizli' }
      await setMode($, mode)
      if (!(await read($, isOn))) {
        await update($, isOn, () => true)
        await keepSet($, 'bandOn', true)
      }
      return { text: `Kota bandı: ${MODE_TR[mode]} görünüm.` }
    }
    const now = !(await read($, isOn))
    await update($, isOn, () => now)
    await keepSet($, 'bandOn', now)
    if (now) await refresh($, 'now')
    return { text: now ? 'Kota bandı açık.' : 'Kota bandı kapalı. Otomatik sıkıştırma çalışmaya devam eder.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)
    const snap = await read($, snapshot)
    if (!snap) return next(e)
    // every read first: from here on the drawing is worked out in one go
    const mode = await read($, view)
    const auto = await read($, autoCompact)
    const ask = await read($, autoAsk)
    const orig = await read($, original)
    const other = await read($, others)
    const now = await $.clock.now()

    const { Box, Text, Button } = $.ui.resolve(e)
    const resolvedSvg = e.surface !== 'terminal' ? $.ui.resolve(e).Svg : undefined
    const Svg = typeof resolvedSvg === 'function' ? resolvedSvg : undefined
    const rawCols = typeof e.props.bodyColumns === 'number' && Number.isFinite(e.props.bodyColumns) ? e.props.bodyColumns : 80
    const width = Math.max(20, Math.floor(rawCols))
    // the desktop's letters are narrower than its cells: about 0.8 of one
    const glyph = Svg ? 0.8 : 1
    // single frame: the host slot provides the outer card, border and padding
    const innerWidth = width
    const list = forecastsOf(snap, now)
    const limits = [...list].sort((a, b) => order(a.kind) - order(b.kind))
    const bind = binding(list)
    const isShort = mode.mode === 'kisa'
    const head = isShort ? headline(list, now) : shortHeadline(list, now)
    const warn = originalLine(orig)
    const rawPercent = typeof snap.percent === 'number' && Number.isFinite(snap.percent) ? Math.max(0, snap.percent) : 0
    const rawWindow = typeof snap.window === 'number' && Number.isFinite(snap.window) ? Math.max(0, snap.window) : 0
    const rawUsed = typeof snap.tokens === 'number' && Number.isFinite(snap.tokens) ? Math.max(0, snap.tokens) : 0
    const shownPct = Math.round(rawPercent)
    const contextLevel = fillLevel(rawPercent)
    const gap = Svg ? 0.5 : 1

    const pctText = (text: string, level: Level, textSize: 'body' | 'footnote' = 'footnote', boxWidth?: number) => (
      <Box
        {...(boxWidth !== undefined ? { width: boxWidth } : {})}
        flexDirection="row"
        flexShrink={0}
        justifyContent="flex-end"
        alignItems="center"
      >
        <Text weight="semibold" size={textSize} tabular color={TEXT_STATUS[level]}>
          {text}
        </Text>
      </Box>
    )

    const askText = ask ? (
      <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={1} minWidth={0}>
        <Text color={FILL[1]}>●</Text>
        <Box flexShrink={1} minWidth={0}>
          <Text weight="medium" size="footnote" wrap="wrap">{askLine(ask)}</Text>
        </Box>
      </Box>
    ) : null
    const ASK_LABELS = ['Şimdi', 'Sonraki sıkıştırma']
    const askButtons = (
      <Box flexDirection="row" columnGap={1} flexWrap="wrap" flexShrink={1} minWidth={0}>
        <Button key="askNow" label={ASK_LABELS[0]!} onPress={() => void answerAsk($, 'now')} />
        <Button key="askNext" label={ASK_LABELS[1]!} onPress={() => void answerAsk($, 'next')} />
      </Box>
    )
    // the question and its two answers on one line when they fit, else the answers beneath
    const askWords = (ask ? askLine(ask).length : 0) + ASK_LABELS.join('').length
    const isAskLine = innerWidth >= askWords * glyph + ASK_LABELS.length * (Svg ? 3 : 4) + 5
    const askRow = ask ? (
      isAskLine ? (
        <Box flexDirection="row" alignItems="center" columnGap={1} marginBottom={gap}>
          {askText}
          {askButtons}
        </Box>
      ) : (
        <Box flexDirection="column" marginBottom={gap}>
          {askText}
          <Box marginTop={gap}>{askButtons}</Box>
        </Box>
      )
    ) : null

    // Hidden: the band is gone but for one small soft-rounded square button at the right
    // end, its dot coloured by the tightest limit (or the context, whichever is worse).
    // Its tip, the short summary, lights beside it under the pointer in high contrast text.
    if (mode.mode === 'gizli') {
      const level = Math.max(bind?.level ?? 0, contextLevel, warn ? 1 : 0) as Level
      const summary =
        (bind ? `En dar limit: ${bind.label} %${shownPercent(bind.percent)} · ` : '') +
        `bağlam %${shownPct}` +
        (warn ? ' · iki kota bandı açık' : '')
      const show = () => void setMode($, mode.last)
      const button = Svg ? (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          {/* the tip: unseen until the pointer is over the button; left out where it
              would not fit on the one row, so the hidden band never grows a second */}
          {width >= summary.length * glyph + HIDDEN_CELLS + 2 ? (
            <Text size="caption" color={CLEAR} hover={{ scope: 'kbGizli', color: 'text' }} wrap="truncate-end">{summary}</Text>
          ) : null}
          <Box key="hiddenBox" width={HIDDEN_CELLS} height={1} overflow="hidden" flexShrink={0}>
            <Box position="absolute" top={0} left={0} width={HIDDEN_CELLS} height={1} borderStyle="round" borderColor={CLEAR} hover={{ scope: 'kbGizli', backgroundColor: LIT, borderColor: LIT_BORDER }} />
            <Box position="absolute" top={0} left={0} width={HIDDEN_CELLS} height={1} alignItems="center" justifyContent="center">
              <Svg alt={`Kota bandını göster. ${summary}`} source={hiddenSvg(level)} width={HIDDEN_W} height={HIDDEN_H} />
            </Box>
            <Box position="absolute" top={0} left={0}>
              <Button key="show" label={'   '} plain hover={{ scope: 'kbGizli', backgroundColor: CLEAR }} onPress={show} />
            </Box>
          </Box>
        </Box>
      ) : (
        <Button key="show" label={width < 26 ? 'Kota' : 'Kota bandını göster'} plain onPress={show}>
          <Text>≡ </Text>
          <Text color={FILL[level]}>●</Text>
        </Button>
      )
      return (
        <Box flexDirection="column">
          {askRow}
          <Box flexDirection="row" justifyContent="flex-end">
            {button}
          </Box>
        </Box>
      )
    }

    // free as /context has it: the window less what is used and the autocompact buffer
    const rawCategories = Array.isArray(snap.categories) ? snap.categories : []
    const buffer = rawCategories.find(c => c.kind === 'buffer')?.tokens ?? 0
    const safeBuffer = Number.isFinite(buffer) && buffer > 0 ? buffer : 0
    const free = Math.max(0, rawWindow - rawUsed - safeBuffer)
    // highest first, as /context lists them: used categories, then the buffer, then free space
    const rank = (c: Category) => (c.kind === 'used' ? 0 : c.kind === 'buffer' ? 1 : 2)
    const shown = rawCategories
      .filter(c => typeof c.tokens === 'number' && Number.isFinite(c.tokens) && c.tokens > 0)
      .map(c => ({
        ...c,
        color: c.kind === 'free' ? (Svg ? TRACK_FILL_SVG : TRACK_CELL) : c.kind === 'buffer' ? (Svg ? BUFFER : BUFFER_CELL) : SWATCH[c.name] ?? BUFFER_CELL,
      }))
      .sort((a, b) => rank(a) - rank(b) || b.tokens - a.tokens)

    // say so when the figures are old: the service refused and no reply has come since
    const age = snap.limitsAt !== undefined && Number.isFinite(snap.limitsAt) ? Math.max(0, now - snap.limitsAt) : 0
    const stale =
      snap.limitsError && age >= 2 * 60_000 && limits.length > 0
        ? `kullanım kontrolü ${snap.limitsError} – veriler ${duration(age)} önceki`
        : snap.limitsError && limits.length === 0
          ? `kullanım kontrolü ${snap.limitsError}`
          : undefined

    // The header: the headline beside the controls when both fit, else the controls on
    // a row of their own beneath it, wrapping onto grouped rows rather than running out
    const CONTROLS = Svg ? (auto.isOn ? 50 : 45) : (auto.isOn ? 48 : 40)
    // the terminal draws its own hide control ([-]) over the band's top-right corner
    const HOST_HIDE = Svg ? 0 : 4
    const isHeadBeside = innerWidth >= (head?.text.length ?? 0) * glyph + 2 + CONTROLS + HOST_HIDE
    // Detailed layout thresholds derived from column requirements:
    // two-column requires 2 columns of >= 40 cells (to keep Bağlam % + free text on one row) + 4 gap = 84
    const SPLIT_GAP = 4
    const MIN_COL_SPLIT = 40
    const isSplit = innerWidth >= MIN_COL_SPLIT * 2 + SPLIT_GAP
    const column = isSplit ? Math.floor((innerWidth - SPLIT_GAP) / 2) : innerWidth
    const CLAUDE_LABEL_W = 8
    const isClaudeWide = column >= 32
    const CLAUDE_PCT_W = isClaudeWide ? 11 : 4
    const claudeCells = Math.max(6, column - CLAUDE_LABEL_W - 1 - 1 - CLAUDE_PCT_W)
    const isContextLine = column >= 34

    const controls = (
      <Box flexDirection="row" alignItems="center" columnGap={1} rowGap={0} flexShrink={isHeadBeside ? 0 : 1} flexWrap="wrap" minWidth={0}>
        <Box flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap" flexShrink={1} minWidth={0}>
          {/* auto compact: the switch, its name, and the % stepper */}
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            {Svg ? (
              <Box key="autoSwitch" width={SWITCH_CELLS} height={1} overflow="hidden" flexShrink={0}>
                <Box position="absolute" top={0} left={0} width={SWITCH_CELLS} height={1} borderStyle="round" borderColor={CLEAR} hover={{ backgroundColor: LIT, borderColor: LIT_BORDER }} />
                <Box position="absolute" top={0} left={0} width={SWITCH_CELLS} height={1} alignItems="center" justifyContent="center">
                  <Svg alt={`Otomatik sıkıştırma ${auto.isOn ? 'açık' : 'kapalı'}`} source={switchSvg(auto.isOn)} width={SWITCH_W} height={SWITCH_H} />
                </Box>
                <Box position="absolute" top={0} left={0}>
                  <Button key="auto" label={'   '} plain hover={{ backgroundColor: CLEAR }} onPress={() => void toggleAuto($)} />
                </Box>
              </Box>
            ) : (
              <Button key="auto" label={auto.isOn ? '●' : '○'} plain onPress={() => void toggleAuto($)} />
            )}
            <Text size="footnote" weight={auto.isOn ? 'medium' : 'regular'}>Oto. sıkıştır</Text>
          </Box>
          {auto.isOn ? (
            <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
              <Button key="autoDown" label="−" plain onPress={() => void stepAt($, -AT_STEP)} />
              <Box width={4} flexDirection="row" flexShrink={0} justifyContent="center" alignItems="center">
                <Text weight="semibold" size="footnote" tabular>{`%${auto.at ?? AT_DEFAULT}`}</Text>
              </Box>
              <Button key="autoUp" label="+" plain onPress={() => void stepAt($, AT_STEP)} />
            </Box>
          ) : Svg && isHeadBeside ? (
            // off beside headline: keep the stepper's room so the switch stays anchored
            <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
              <Text size="footnote" color={CLEAR}>{`− %${auto.at ?? AT_DEFAULT} +`}</Text>
            </Box>
          ) : null}
        </Box>
        <Box flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap" flexShrink={isHeadBeside ? 0 : 1} minWidth={0}>
          <Box key="compactBox" marginLeft={isHeadBeside ? 1 : 0} flexShrink={0}>
            <Button key="compact" label="Sıkıştır" hover={{ backgroundColor: LIT }} onPress={() => compactNow($)} />
          </Box>
          {/* the mode: ▼ folds the band to short view, ▲ opens it; Gizle leaves a button */}
          <Button key="collapse" label={isShort ? '▲' : '▼'} plain onPress={() => void setMode($, isShort ? 'detayli' : 'kisa')} />
          <Button key="hide" label="Gizle" plain onPress={() => void setMode($, 'gizli')} />
        </Box>
      </Box>
    )
    const headText = head ? (
      <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={1} minWidth={0}>
        <Text color={TEXT_STATUS[head.level]}>●</Text>
        <Box flexShrink={1} minWidth={0}>
          <Text weight="semibold" size="body" wrap="wrap">{head.text}</Text>
        </Box>
      </Box>
    ) : (
      <Text size="body"> </Text>
    )
    const header = isHeadBeside ? (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginBottom={1} paddingRight={HOST_HIDE}>
        <Box flexShrink={1} minWidth={0}>{headText}</Box>
        {controls}
      </Box>
    ) : (
      <Box flexDirection="column" marginBottom={1}>
        <Box paddingRight={HOST_HIDE}>{headText}</Box>
        <Box marginTop={gap}>{controls}</Box>
      </Box>
    )
    const warnRow = warn ? (
      <Box flexDirection="row" alignItems="center" columnGap={1} marginBottom={gap}>
        <Text color={TEXT_STATUS[1]}>●</Text>
        <Box flexShrink={1} minWidth={0}>
          <Text size="footnote" wrap="wrap">{warn}</Text>
        </Box>
      </Box>
    ) : null

    // one bar: a 1:1 Svg pill on graphical surfaces, slim line glyphs on the terminal
    const bar = (alt: string, segments: Segment[], barCells: number, marker?: number, f?: Forecast) =>
      Svg ? (
        <Box width={barCells} height={1} alignItems="center" flexShrink={0}>
          <Svg alt={alt} source={barSvg(segments, barCells * 8, marker)} height={SVG_BAR_H} />
        </Box>
      ) : (
        <Box flexDirection="row" width={barCells} flexShrink={0}>
          {(f ? limitCellRuns(f, barCells) : contextCellRuns(segments, barCells)).map(run => (
            <Text color={run.color}>{run.text}</Text>
          ))}
        </Box>
      )
    const remainingBar = (alt: string, leftPct: number, level: Level, barCells: number, marker?: number, dimColor = false) => {
      const clampedLeft = Math.max(0, Math.min(100, Number.isFinite(leftPct) ? leftPct : 0))
      const segs: Segment[] = [
        { color: FILL[level], share: clampedLeft, kind: 'used' },
        { color: Svg ? TRACK_FILL_SVG : TRACK_CELL, share: Math.max(0, 100 - clampedLeft), kind: 'free' },
      ]
      return Svg ? (
        <Box width={barCells} height={1} alignItems="center" flexShrink={0}>
          <Svg alt={alt} source={barSvg(segs, barCells * 8, marker)} height={SVG_BAR_H} />
        </Box>
      ) : (
        <Box flexDirection="row" width={barCells} flexShrink={0}>
          {remainingCellRuns(clampedLeft, level, barCells, marker).map(run => (
            <Text color={run.color} dimColor={dimColor}>{run.text}</Text>
          ))}
        </Box>
      )
    }
    const limitSegments = (f: Forecast): Segment[] => {
      const pct = Math.max(0, Math.min(100, Number.isFinite(f.percent) ? f.percent : 0))
      return [
        { color: FILL[f.level], share: pct, kind: 'used' },
        { color: Svg ? TRACK_FILL_SVG : TRACK_CELL, share: Math.max(0, 100 - pct), kind: 'free' },
      ]
    }
    // the context bar in three colours: Messages, Tools, and one grey run for Other and
    // the autocompact buffer together; then free. Always in that order
    const BAR_ORDER = ['Messages', 'Tools', 'Other']
    const barRank = (c: (typeof shown)[number]) => (c.kind === 'used' ? Math.max(0, BAR_ORDER.indexOf(c.name)) : c.kind === 'buffer' ? 3 : 4)
    const contextSegments = [...shown]
      .sort((a, b) => barRank(a) - barRank(b))
      .map(c => ({ color: c.color, share: c.tokens, kind: c.kind }))
      .reduce<Segment[]>((runs, seg) => {
        const last = runs[runs.length - 1]
        if (last && last.color === seg.color && last.kind === seg.kind) last.share += seg.share
        else runs.push({ ...seg })
        return runs
      }, [])

    // the window that binds first is underlined, in the rows and in the short view
    const isBinding = (f: Forecast) => bind !== undefined && f.kind === bind.kind && list.filter(x => x.status !== 'idle').length > 1

    // "Diğer platformlar" section: every active pool from Cetvel as its own row/card.
    // Width thresholds (innerWidth):
    //   >= 81 : 4-column table (Platform 24 | 5s 18 | Haftalık 18 | Sıfırlama 15, gap 2)
    //   64..80: 3-column table (Platform 24 | 5s 18 | Haftalık 18, reset in hover hint)
    //   42..63: 2-row cards with mini bars
    //   < 42  : 2-row text cards without bars (never wraps out of bounds)
    const OTHER_NAME_W = 24
    const OTHER_WIN_W = 18
    const OTHER_RESET_W = 15
    const OTHER_GAP = 2
    const OTHER_MINI_BAR = 6
    const OTHER_CARD_BAR = 5
    const isOtherTable4 = innerWidth >= OTHER_NAME_W + OTHER_WIN_W * 2 + OTHER_RESET_W + OTHER_GAP * 3
    const isOtherTable3 = !isOtherTable4 && innerWidth >= OTHER_NAME_W + OTHER_WIN_W * 2 + OTHER_GAP * 2
    const isOtherTable = isOtherTable4 || isOtherTable3
    const isOtherCardBars = !isOtherTable && innerWidth >= 42

    const resetCellText = (o: Other): string => {
      const rw = poolResetWindow(o, now)
      if (!rw || rw.resetsAt === undefined || !Number.isFinite(rw.resetsAt) || rw.resetsAt <= now) return '—'
      const clock = shortClock(rw.resetsAt, now)
      const withDur = `${clock} (${duration(rw.resetsAt - now)})`
      return withDur.length <= OTHER_RESET_W ? withDur : clock
    }

    const otherHintText = (o: Other): string | undefined => {
      const parts: string[] = []
      const models = poolModels(o.id)
      if (models) parts.push(`Modeller: ${models}`)
      const wins = Array.isArray(o.windows) ? o.windows : []
      for (const w of wins) {
        const hasFutureReset = typeof w.resetsAt === 'number' && Number.isFinite(w.resetsAt) && w.resetsAt > now
        if (w.left === 0) {
          parts.push(
            hasFutureReset
              ? `${w.label} tükendi · açılış ${shortClock(w.resetsAt!, now)} (${spaceDuration(w.resetsAt! - now)})`
              : `${w.label} tükendi`,
          )
        } else if (hasFutureReset && (!isOtherTable4 || wins.length > 1)) {
          parts.push(`${w.label} sıfırlama ${shortClock(w.resetsAt!, now)} (${spaceDuration(w.resetsAt! - now)})`)
        }
      }
      return parts.length > 0 ? parts.join(' · ') : undefined
    }

    const renderTableCell = (w: OtherWindow | undefined, isMuted: boolean) => {
      if (!w) {
        return (
          <Box width={OTHER_WIN_W} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            <Box width={OTHER_MINI_BAR} flexShrink={0} />
            <Box width={4} flexDirection="row" justifyContent="flex-end" flexShrink={0}>
              <Text size="footnote" color={MUTED} dimColor={isMuted}>—</Text>
            </Box>
          </Box>
        )
      }
      const isExhausted = w.left === 0
      const cellTag = windowCellLabel(w)
      return (
        <Box width={OTHER_WIN_W} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          {remainingBar(`${w.label} %${w.left} kalan`, w.left, w.level, OTHER_MINI_BAR, undefined, isMuted)}
          <Box width={isExhausted ? 7 : 4} flexDirection="row" justifyContent="flex-end" flexShrink={0}>
            {isExhausted ? (
              <Text size="footnote" weight="semibold" color={TEXT_STATUS[2]} dimColor={isMuted}>tükendi</Text>
            ) : (
              <Text size="footnote" weight="semibold" tabular color={TEXT_STATUS[w.level]} dimColor={isMuted}>{`%${w.left}`}</Text>
            )}
          </Box>
          {cellTag ? (
            <Box flexShrink={1} minWidth={0}>
              <Text size="footnote" color={MUTED} dimColor={isMuted} wrap="truncate-end">{cellTag}</Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    const cardLabelOf = (w: OtherWindow | undefined, fallback: string) => {
      if (!w) return fallback
      if (w.key === '5s') return '5s'
      if (w.key === 'hafta') return 'hf'
      return windowCellLabel(w) ?? w.label
    }

    const renderCardBarSlot = (w: OtherWindow | undefined, fallbackLabel: string, isMuted: boolean) => {
      const label = cardLabelOf(w, fallbackLabel)
      if (!w) {
        return (
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            <Text size="footnote" color={MUTED} dimColor={isMuted}>{label}</Text>
            <Text size="footnote" color={MUTED} dimColor={isMuted}>—</Text>
          </Box>
        )
      }
      const isExhausted = w.left === 0
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          <Text size="footnote" color={MUTED} dimColor={isMuted}>{label}</Text>
          {remainingBar(`${w.label} %${w.left} kalan`, w.left, w.level, OTHER_CARD_BAR, undefined, isMuted)}
          {isExhausted ? (
            <Text size="footnote" weight="semibold" color={TEXT_STATUS[2]} dimColor={isMuted}>tükendi</Text>
          ) : (
            <Text size="footnote" weight="semibold" tabular color={TEXT_STATUS[w.level]} dimColor={isMuted}>{`%${w.left}`}</Text>
          )}
        </Box>
      )
    }

    const renderCardTextSlot = (w: OtherWindow | undefined, fallbackLabel: string, isMuted: boolean) => {
      const label = cardLabelOf(w, fallbackLabel)
      if (!w) {
        return (
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            <Text size="footnote" color={MUTED} dimColor={isMuted}>{`${label} —`}</Text>
          </Box>
        )
      }
      const isExhausted = w.left === 0
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          <Text size="footnote" color={MUTED} dimColor={isMuted}>{label}</Text>
          {isExhausted ? (
            <Text size="footnote" weight="semibold" color={TEXT_STATUS[2]} dimColor={isMuted}>tükendi</Text>
          ) : (
            <Text size="footnote" weight="semibold" tabular color={TEXT_STATUS[w.level]} dimColor={isMuted}>{`%${w.left}`}</Text>
          )}
        </Box>
      )
    }

    const otherList = other && Array.isArray(other.others) ? other.others : []
    const otherBlock = otherList.length > 0 ? (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
          <Text size="body" weight="semibold">Diğer platformlar</Text>
          <Text size="footnote" color={MUTED}>· kalan</Text>
          {other?.isStale ? (
            <Box flexShrink={1} minWidth={0}>
              <Text size="footnote" color={MUTED} wrap="wrap">{STALE_NOTE}</Text>
            </Box>
          ) : null}
        </Box>
        {isOtherTable ? (
          <Box flexDirection="column" marginTop={gap} rowGap={Svg ? 0.5 : 0}>
            <Box flexDirection="row" alignItems="center" columnGap={OTHER_GAP}>
              <Box width={OTHER_NAME_W} flexShrink={0}>
                <Text size="footnote" color={MUTED}>Platform</Text>
              </Box>
              <Box width={OTHER_WIN_W} flexShrink={0}>
                <Text size="footnote" color={MUTED}>5 saat kalan</Text>
              </Box>
              <Box width={OTHER_WIN_W} flexShrink={0}>
                <Text size="footnote" color={MUTED}>Haftalık kalan</Text>
              </Box>
              {isOtherTable4 ? (
                <Box width={OTHER_RESET_W} flexDirection="row" justifyContent="flex-end" flexShrink={0}>
                  <Text size="footnote" color={MUTED}>Sıfırlama</Text>
                </Box>
              ) : null}
            </Box>
            {otherList.map(o => {
              const isMuted = Boolean(o.isStale || other?.isStale)
              const { shortWin, longWin } = poolSlots(o)
              const resetCell = resetCellText(o)
              const hint = otherHintText(o)
              return (
                <Box key={`other-${o.id}`} flexDirection="column">
                  <Box flexDirection="row" alignItems="center" columnGap={OTHER_GAP}>
                    <Box width={OTHER_NAME_W} flexShrink={0}>
                      <Text size="footnote" weight="medium" dimColor={isMuted} wrap="truncate-end">{o.name}</Text>
                    </Box>
                    {renderTableCell(shortWin, isMuted)}
                    {renderTableCell(longWin, isMuted)}
                    {isOtherTable4 ? (
                      <Box width={OTHER_RESET_W} flexDirection="row" justifyContent="flex-end" flexShrink={0}>
                        <Text size="footnote" color={MUTED} dimColor={isMuted} tabular wrap="truncate-end">{resetCell}</Text>
                      </Box>
                    ) : null}
                  </Box>
                  {hint ? (
                    <Box display="none" hover={{ display: 'flex' }}>
                      <Text size="footnote" color={MUTED} wrap="wrap">{hint}</Text>
                    </Box>
                  ) : null}
                </Box>
              )
            })}
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={gap}>
            {otherList.map((o, i) => {
              const isMuted = Boolean(o.isStale || other?.isStale)
              const { shortWin, longWin } = poolSlots(o)
              const resetCell = resetCellText(o)
              const hint = otherHintText(o)
              return (
                <Box key={`other-${o.id}`} flexDirection="column" marginTop={i > 0 ? gap : 0}>
                  <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
                    <Box flexShrink={1} minWidth={0}>
                      <Text size="footnote" weight="medium" dimColor={isMuted} wrap="truncate-end">{o.name}</Text>
                    </Box>
                    {innerWidth >= 34 && resetCell !== '—' ? (
                      <Box flexDirection="row" justifyContent="flex-end" flexShrink={0}>
                        <Text size="footnote" color={MUTED} dimColor={isMuted} tabular>{resetCell}</Text>
                      </Box>
                    ) : null}
                  </Box>
                  {isOtherCardBars ? (
                    <Box flexDirection="row" alignItems="center" columnGap={2}>
                      {renderCardBarSlot(shortWin, '5s', isMuted)}
                      {renderCardBarSlot(longWin, 'hf', isMuted)}
                    </Box>
                  ) : (
                    <Box flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
                      {renderCardTextSlot(shortWin, '5s', isMuted)}
                      <Text size="footnote" color={MUTED} dimColor={isMuted}>·</Text>
                      {renderCardTextSlot(longWin, 'hf', isMuted)}
                    </Box>
                  )}
                  {hint ? (
                    <Box display="none" hover={{ display: 'flex' }}>
                      <Text size="footnote" color={MUTED} wrap="wrap">{hint}</Text>
                    </Box>
                  ) : null}
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    ) : null

    const claudeRowLabel = (kind: string, label: string) => (kind === 'five_hour' ? '5 saat' : label)

    const limitsBlock = (
      <Box flexDirection="column" {...(isSplit ? { width: column, flexShrink: 0 } : { flexShrink: 1, minWidth: 0 })}>
        <Text size="body" weight="semibold">Claude</Text>
        {limits.length === 0 ? <Text size="footnote" color={MUTED} wrap="wrap">Kullanım limitleri ilk yanıttan sonra görünür.</Text> : null}
        {stale ? (
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            <Text color={TEXT_STATUS[1]}>●</Text>
            <Box flexShrink={1} minWidth={0}>
              <Text size="footnote" color={MUTED} wrap="wrap">{stale}</Text>
            </Box>
          </Box>
        ) : null}
        {limits.map((f, i) => {
          const leftPct = leftOf(f)
          const rowLabel = claudeRowLabel(f.kind, f.label)
          const marker = leftMarkerOf(f)
          const isAlert = f.status === 'out' || f.status === 'hit'
          const rightLabel = isClaudeWide ? `%${leftPct} kalan` : `%${leftPct}`
          return (
            <Box flexDirection="column" marginTop={i > 0 ? 1 : Svg ? gap : 0}>
              <Box flexDirection="row" alignItems="center">
                <Box width={CLAUDE_LABEL_W} flexShrink={0}>
                  <Text weight="medium" size="footnote" underline={isBinding(f)} wrap="truncate-end">{rowLabel}</Text>
                </Box>
                <Box width={1} flexShrink={0} />
                {remainingBar(`${rowLabel} %${leftPct} kalan`, leftPct, f.level, claudeCells, marker)}
                <Box width={1} flexShrink={0} />
                {pctText(rightLabel, f.level, 'body', CLAUDE_PCT_W)}
              </Box>
              <Box flexDirection="row" alignItems="center" columnGap={1}>
                {isAlert ? <Text size="footnote" color={TEXT_STATUS[f.level]}>▲</Text> : null}
                <Box flexShrink={1} minWidth={0}>
                  <Text size="footnote" color={MUTED} wrap="wrap">{detailNoteOf(f, now)}</Text>
                </Box>
              </Box>
            </Box>
          )
        })}
      </Box>
    )

    const contextStats = (
      <Box flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap" flexShrink={isContextLine ? 0 : 1} minWidth={0}>
        <Text size="body" weight="semibold" tabular color={TEXT_STATUS[contextLevel]}>{`%${shownPct} dolu`}</Text>
        <Text size="footnote" color={MUTED} tabular>{`· ${tokens(free)} boş`}</Text>
      </Box>
    )
    const legend = (['Messages', 'Tools', 'Other'] as const)
      .map(name => shown.find(c => c.name === name && c.kind === 'used'))
      .filter((c): c is (typeof shown)[number] => c !== undefined)
    const contextSummary = isContextLine ? (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2}>
        <Text weight="semibold" size="body">Bağlam</Text>
        {contextStats}
      </Box>
    ) : (
      <Box flexDirection="column">
        <Text weight="semibold" size="body">Bağlam</Text>
        {contextStats}
      </Box>
    )
    const contextLegend = (
      <Box flexDirection="column" marginTop={gap} rowGap={Svg ? 0.5 : 0}>
        {legend.map(c => (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              <Text color={c.color}>●</Text>
              <Text size="footnote">{GROUP_TR[c.name] ?? c.name}</Text>
            </Box>
            <Box minWidth={5} flexDirection="row" justifyContent="flex-end" flexShrink={0}>
              <Text size="footnote" weight="medium" tabular>{tokens(c.tokens)}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    )
    const contextBlock = (
      <Box flexDirection="column" {...(isSplit ? { width: column, flexShrink: 0 } : { flexShrink: 1, minWidth: 0 })}>
        {contextSummary}
        <Box marginTop={Svg ? gap : 0}>
          {bar(`Bağlam %${shownPct} dolu`, contextSegments, column)}
        </Box>
        {contextLegend}
      </Box>
    )

    // Short: the limits by a short name and the time to their reset, then the context
    // with its whole window; a window not running shows its whole length (5sa, 7g)
    const compactItems = [
      ...limits.map(f => ({
        label: f.label,
        short: f.kind === 'five_hour' ? '5 Saat' : f.kind === 'seven_day' ? 'Hafta' : f.label,
        until: f.status === 'idle' || !Number.isFinite(f.resetsAt) ? duration(WINDOWS[f.kind]?.ms ?? 0) : duration(f.resetsAt - now),
        pct: `%${shownPercent(f.percent)}`,
        level: f.level,
        marker: markerOf(f),
        segments: limitSegments(f),
        f: f as Forecast | undefined,
      })),
      { label: 'Bağlam', short: 'Bağlam', until: tokens(rawWindow), pct: `%${shownPct}`, level: contextLevel, marker: undefined as number | undefined, segments: contextSegments, f: undefined as Forecast | undefined },
    ]
    type Item = (typeof compactItems)[number]
    const contextItem = compactItems[compactItems.length - 1]!
    const nameOf = (item: Item, withUntil = true) => (
      <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
        <Text weight="semibold" size="footnote" underline={item.f ? isBinding(item.f) : false}>{item.short}</Text>
        {withUntil && item.until ? <Text size="caption" tabular>{item.until}</Text> : null}
      </Box>
    )
    const nameLength = (item: Item, withUntil = true) => item.short.length + (withUntil && item.until ? item.until.length + 1 : 0)
    // Short thresholds derived strictly from fixed slot widths so Turkish long durations
    // ("4sa 59dk" = 8, "6g 23sa" = 7) and window sizes ("200k" = 4) never clip or overlap:
    //   5 Saat (6+1+8 + 1+1+4 = 21) + Hafta (5+1+8 + 1+1+4 = 20) + Bağlam (6+1+4 + 1+1+4 = 17) + gaps (4) = 62
    //   With MIN_ONE_ROW_BAR = 8 cells per bar -> 62 + 3 * 8 = 86 inner columns required for 1-row.
    //   Medium (55..85): 2 limits on row 1 (43 + 2*6 = 55) + Bağlam full-width on row 2.
    //   Narrow (< 55): 3 aligned rows stacked vertically.
    const TIME_CELLS = 8
    const CTX_TIME_CELLS = Math.max(4, contextItem.until.length)
    const PCT_CELLS = 4
    const SHORT_GAP = 2
    const MIN_ONE_ROW_BAR = 8
    const MIN_TWO_ROW_BAR = 6
    const limitItems = compactItems.filter(item => item.f)
    const nameSlotWidth = (item: Item, withUntil = true) =>
      !withUntil ? item.short.length : item.short.length + 1 + (item === contextItem ? CTX_TIME_CELLS : TIME_CELLS)
    const fixedSlotOf = (item: Item) => nameSlotWidth(item, true) + 1 + 1 + PCT_CELLS
    const oneRowFixed = compactItems.reduce((sum, item) => sum + fixedSlotOf(item), 0) + SHORT_GAP * (compactItems.length - 1)
    const oneBar = Math.floor((innerWidth - oneRowFixed) / compactItems.length)
    const isOneRow = oneBar >= MIN_ONE_ROW_BAR
    const contextBar = Math.max(MIN_ONE_ROW_BAR, innerWidth - oneRowFixed - oneBar * limitItems.length)
    const twoRowFixed = limitItems.reduce((sum, item) => sum + fixedSlotOf(item), 0) + SHORT_GAP * Math.max(0, limitItems.length - 1)
    const twoRowBar = limitItems.length > 0 ? Math.floor((innerWidth - twoRowFixed) / limitItems.length) : 0
    const isTwoRowShort = !isOneRow && limitItems.length > 0 && twoRowBar >= MIN_TWO_ROW_BAR
    const twoRowExtra = isTwoRowShort ? Math.max(0, innerWidth - twoRowFixed - twoRowBar * limitItems.length) : 0

    const renderShortSlot = (item: Item, barWidth: number, isFlexibleContext = false) => (
      <Box
        flexDirection="row"
        alignItems="center"
        {...(isFlexibleContext
          ? { flexGrow: 1, flexShrink: 1, minWidth: 0 }
          : { width: fixedSlotOf(item) + barWidth, flexShrink: 0 })}
      >
        <Box width={nameSlotWidth(item, true)} marginRight={1} flexShrink={0}>
          {nameOf(item)}
        </Box>
        {isFlexibleContext && Svg ? (
          <Box flexGrow={1} flexShrink={1} minWidth={0} height={1} alignItems="center">
            <Svg alt={`Bağlam ${item.pct} dolu`} source={barSvg(item.segments, Math.max(48, barWidth * 8))} height={SVG_BAR_H} />
          </Box>
        ) : (
          bar(item === contextItem ? `Bağlam ${item.pct} dolu` : `${item.label} ${item.pct} kullanıldı`, item.segments, barWidth, item.marker, item.f)
        )}
        <Box marginLeft={1} flexShrink={0}>
          {pctText(item.pct, item.level, 'footnote', PCT_CELLS)}
        </Box>
      </Box>
    )

    const shortBlock = isOneRow ? (
      <Box key="shortOneRow" flexDirection="row" columnGap={SHORT_GAP}>
        {compactItems.map(item => renderShortSlot(item, item === contextItem ? contextBar : oneBar, item === contextItem))}
      </Box>
    ) : isTwoRowShort ? (
      <Box key="shortTwoRow" flexDirection="column" rowGap={Svg ? 0.5 : 0}>
        <Box flexDirection="row" columnGap={SHORT_GAP}>
          {limitItems.map((item, idx) => renderShortSlot(item, twoRowBar + (idx === limitItems.length - 1 ? twoRowExtra : 0), false))}
        </Box>
        {renderShortSlot(contextItem, Math.max(MIN_TWO_ROW_BAR, innerWidth - fixedSlotOf(contextItem)), true)}
      </Box>
    ) : (
      // narrow: each item on a row of its own, names in one fixed column and %s aligned right
      (() => {
        const maxNameWithTime = Math.max(8, ...compactItems.map(item => Math.max(nameLength(item, true) + 1, nameSlotWidth(item, true) + 1)))
        const withUntil = innerWidth >= maxNameWithTime + 1 + PCT_CELLS + 8
        const nameCells = Math.max(7, ...compactItems.map(item => nameLength(item, withUntil) + 1))
        const barCells = Math.max(6, innerWidth - nameCells - 1 - PCT_CELLS)
        return (
          <Box key="shortStack" flexDirection="column" rowGap={Svg ? 0.5 : 0}>
            {compactItems.map(item => (
              <Box flexDirection="row" alignItems="center">
                <Box width={nameCells} flexShrink={0}>
                  {nameOf(item, withUntil)}
                </Box>
                {bar(item === contextItem ? `Bağlam ${item.pct} dolu` : `${item.label} ${item.pct} kullanıldı`, item.segments, barCells, item.marker, item.f)}
                <Box marginLeft={1} flexShrink={0}>
                  {pctText(item.pct, item.level, 'footnote', PCT_CELLS)}
                </Box>
              </Box>
            ))}
          </Box>
        )
      })()
    )

    // The detailed band falls back to the short one when the room above the prompt is
    // shorter than it (the setting stays): rows counted from the words and the widths
    const rowsOf = (text: string, cols: number) => Math.max(1, Math.ceil((text.length * glyph) / Math.max(1, cols)))
    const maxRows = typeof e.props.maxRows === 'number' && Number.isFinite(e.props.maxRows) ? Math.max(1, e.props.maxRows) : 40
    const controlsRows = isHeadBeside ? 1 : innerWidth < 26 ? 3 : innerWidth < CONTROLS ? 2 : 1
    const headRows = isHeadBeside ? 1 : rowsOf(head?.text ?? ' ', Math.max(1, innerWidth - HOST_HIDE)) + controlsRows
    const otherRows =
      otherList.length > 0
        ? 1 +
          1 +
          (isOtherTable ? 1 + otherList.length : otherList.length * (isOtherCardBars ? 2 : 3))
        : 0
    const askRows = ask
      ? isAskLine
        ? 1
        : rowsOf(askLine(ask), Math.max(1, innerWidth - 2)) + (innerWidth < 30 ? 2 : 1)
      : 0
    const extraRows = (warn ? rowsOf(warn, innerWidth) : 0) + askRows
    const limitRows =
      1 +
      (limits.length === 0 ? 1 : 0) +
      (stale ? rowsOf(stale, column) : 0) +
      limits.reduce((sum, f) => {
        const isAlert = f.status === 'out' || f.status === 'hit'
        return sum + 1 + rowsOf(detailNoteOf(f, now), Math.max(1, column - (isAlert ? 2 : 0)))
      }, 0) +
      Math.max(0, limits.length - 1)
    const contextRows = (isContextLine ? 1 : 2) + 1 + (Svg ? 0 : 1) + legend.length
    const detailRows = headRows + 1 + extraRows + (isSplit ? Math.max(limitRows, contextRows) : limitRows + 1 + contextRows) + otherRows
    const isDetailed = !isShort && detailRows <= maxRows

    return (
      <Box flexDirection="column">
        {header}
        {warnRow}
        {askRow}
        {!isDetailed ? (
          shortBlock
        ) : isSplit ? (
          <Box key="detailSplit" flexDirection="row" columnGap={SPLIT_GAP}>
            {limitsBlock}
            {contextBlock}
          </Box>
        ) : (
          <Box key="detailStack" flexDirection="column">
            {limitsBlock}
            <Text> </Text>
            {contextBlock}
          </Box>
        )}
        {isDetailed ? otherBlock : null}
      </Box>
    )
  })
}
