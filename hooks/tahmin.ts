// The forecast, kept apart from the drawing: pure functions of a reading, the time and
// the learned pace, so the band, the toasts and the hidden button all read one answer.
import type { Ewma, Limit, PaceOf } from '../types'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
// `maxPerHour`: the fastest pace (% of the window an hour) a Cetvel forecast may give
// before it is taken for a glitch. The 5 hour window can fill in an hour; the weekly one
// cannot fill inside one 5 hour window (that one holds you back first), so 100% in 5h.
export const WINDOWS: Record<string, { label: string; adj: string; ms: number; maxPerHour: number }> = {
  five_hour: { label: '5 Saat', adj: '5 saatlik', ms: 5 * HOUR, maxPerHour: 100 },
  seven_day: { label: 'Haftalık', adj: 'haftalık', ms: 7 * DAY, maxPerHour: 100 / 5 },
}

/** 0 fine, 1 watch it, 2 near or at the end: the band picks its colours from this */
export type Level = 0 | 1 | 2

export type Forecast = {
  kind: string
  label: string
  percent: number
  resetsAt: number
  /** 'idle': no window running (unused, or reset): 0% until the next message starts one */
  status: 'hit' | 'ok' | 'out' | 'idle'
  projected: number
  runOutAt: number
  level: Level
  /** too little of the window seen (or no past window learned) to trust: shown as "tahmini" */
  isRough: boolean
  /** whose pace: Cetvel's EWMA of its samples, or the band's own blend */
  basis: 'cetvel' | 'yerel'
}

// The pace a window is forecast at: your usual one (the median of how far your past
// windows got) blended with this window's own, which takes over as the window runs: it
// counts for half a quarter of the way in. Early jumps barely move it. `skip`: the %
// the first reply of a reopened chat took re-reading its old context, a one-off left
// out of the pace (still in the % used).
// With Cetvel running and holding a forecast for this very window (its reset within a
// few minutes of this one's), its EWMA pace is taken instead: it reads every sample of
// every chat, where the band sees only its own readings. Not a 'deneysel' (unchecked)
// one for a window of a day or more: Cetvel itself keeps those out of its own warnings,
// since half its pace is the last half hour's, and a short busy spell spread over the
// rest of a week reads as a week run out. There the band's damped blend stays.
export const TYPICAL_DEFAULT = 50
const TRUST = 0.25
// a forecast is "tahmini" before a quarter of the window, or before half of it while no
// past window has been learned yet
const ROUGH_BEFORE = 0.25
const ROUGH_UNLEARNED_BEFORE = 0.5

// A limit's level by what is used, as the band shows it: amber from 75%, red from 90%
export const LIMIT_AMBER_AT = 75
export const LIMIT_RED_AT = 90

/** The % as the band writes it: 99.6 is not full, so it reads 99 until it is 100. */
export function shownPercent(p: number): number {
  if (!Number.isFinite(p)) return 0
  return p >= 100 ? 100 : Math.max(0, Math.min(99, Math.round(p)))
}

export function usedLevel(p: number): Level {
  const shown = shownPercent(p)
  return shown >= LIMIT_RED_AT ? 2 : shown >= LIMIT_AMBER_AT ? 1 : 0
}

const worse = (a: Level, b: Level): Level => (a > b ? a : b)

// a Cetvel forecast is for this window when its reset is this one's, give or take
const SAME_RESET_MS = 10 * MINUTE

export function forecast(limit: Limit, now: number, pace?: PaceOf, ewma?: Ewma): Forecast | null {
  if (!Number.isFinite(now)) return null
  const win = WINDOWS[limit.kind]
  if (!win) return null
  const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
  const p = Number.isFinite(limit.percentUsed) ? Math.max(0, limit.percentUsed) : 0
  // no reset time, or one already passed: the window is not running, so it is at 0
  if (!Number.isFinite(resetsAt) || resetsAt <= now) {
    return { kind: limit.kind, label: win.label, percent: 0, resetsAt: NaN, status: 'idle', projected: 0, runOutAt: Infinity, level: 0, isRough: false, basis: 'yerel' }
  }
  const remaining = Math.max(0, resetsAt - now)
  const elapsed = Math.max(1, win.ms - remaining)
  const ewmaReset = ewma?.resetsAt ? Date.parse(ewma.resetsAt) : NaN
  const cetvel =
    ewma &&
    Number.isFinite(ewmaReset) &&
    Number.isFinite(ewma.ratePerHour) &&
    ewma.ratePerHour >= 0 &&
    ewma.ratePerHour <= win.maxPerHour &&
    (ewma.isReady || win.ms < DAY) &&
    Math.abs(ewmaReset - resetsAt) <= SAME_RESET_MS
      ? ewma
      : undefined
  // Cetvel's own trial ('hazir') stands for its forecast; a 'deneysel' one is rough as
  // early in the window as the band's own (no "unlearned" clause: it rests on samples)
  const isRough = cetvel
    ? !cetvel.isReady && elapsed < win.ms * ROUGH_BEFORE
    : elapsed < win.ms * ROUGH_BEFORE || ((pace?.n ?? 0) === 0 && elapsed < win.ms * ROUGH_UNLEARNED_BEFORE)
  const basis: Forecast['basis'] = cetvel ? 'cetvel' : 'yerel'
  const base = { kind: limit.kind, label: win.label, percent: p, resetsAt, isRough, basis }
  if (p >= 100) return { ...base, status: 'hit', projected: p, runOutAt: now, level: 2, isRough: false }
  let rate: number
  if (cetvel) rate = cetvel.ratePerHour / HOUR
  else {
    const typical = pace && Number.isFinite(pace.typical) ? Math.max(0, pace.typical) : TYPICAL_DEFAULT
    const skip = pace && Number.isFinite(pace.skip) ? Math.max(0, pace.skip) : 0
    const own = Math.max(0, p - skip) / elapsed
    const weight = elapsed / (elapsed + win.ms * TRUST)
    rate = weight * own + (1 - weight) * (typical / win.ms)
  }
  const projected = p + rate * remaining
  const runOutAt = rate > 0 ? now + (100 - p) / rate : Infinity
  if (!Number.isFinite(projected) || projected < 100 || rate <= 0 || !Number.isFinite(runOutAt)) {
    return { ...base, status: 'ok', projected: Number.isFinite(projected) ? projected : p, runOutAt: Infinity, level: usedLevel(p) }
  }
  return {
    ...base,
    status: 'out',
    projected,
    runOutAt,
    // a rough forecast warns (amber), never alarms (red), unless what is used already does
    level: worse(projected > 130 && !isRough ? 2 : 1, usedLevel(p)),
  }
}

/**
 * The window that holds you back first, the one the band underlines: a full one (the
 * one that opens last, since nothing goes until it does), else the one that runs out
 * first at this pace, else the one with the least left (the weekly on a tie).
 */
export function binding(list: readonly Forecast[]): Forecast | undefined {
  const hit = list.filter(f => f.status === 'hit').sort((a, b) => b.resetsAt - a.resetsAt)[0]
  if (hit) return hit
  const out = list.filter(f => f.status === 'out').sort((a, b) => a.runOutAt - b.runOutAt)[0]
  if (out) return out
  const weekly = (f: Forecast) => (f.kind === 'seven_day' ? 1 : 0)
  return list
    .filter(f => f.status !== 'idle')
    .sort((a, b) => shownPercent(b.percent) - shownPercent(a.percent) || weekly(b) - weekly(a))[0]
}

/** What is left of the binding window, as the band writes it. */
export const leftOf = (f: Forecast) => 100 - shownPercent(f.percent)

export function duration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 30_000) return '<1dk'
  const m = Math.max(0, Math.round(ms / MINUTE))
  const d = Math.floor(m / 1440)
  const hours = Math.floor((m % 1440) / 60)
  const min = m % 60
  if (d > 0) return hours > 0 ? `${d}g ${hours}sa` : `${d}g`
  if (hours > 0) return min > 0 ? `${hours}sa ${min}dk` : `${hours}sa`
  return `${min}dk`
}

const time = (t: number) => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
const weekday = (t: number) => new Date(t).toLocaleDateString('tr-TR', { weekday: 'long' })
const shortDay = (t: number) => new Date(t).toLocaleDateString('tr-TR', { weekday: 'short' })
const dayMonth = (t: number) => new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
const isSameDay = (a: number, b: number) => new Date(a).toLocaleDateString('tr-TR') === new Date(b).toLocaleDateString('tr-TR')

export function spaceDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 30_000) return '<1 dk'
  const m = Math.max(0, Math.round(ms / MINUTE))
  const d = Math.floor(m / 1440)
  const hours = Math.floor((m % 1440) / 60)
  const min = m % 60
  if (d > 0) return hours > 0 ? `${d} g ${hours} sa` : `${d} g`
  if (hours > 0) return min > 0 ? `${hours} sa ${min} dk` : `${hours} sa`
  return `${min} dk`
}

export function shortClock(t: number, now: number): string {
  if (!Number.isFinite(t) || !Number.isFinite(now)) return '—'
  if (isSameDay(t, now)) return time(t)
  if (isSameDay(t, now + 24 * HOUR)) return `yarın ${time(t)}`
  if (t >= now && t - now < 6 * DAY && weekday(t) !== weekday(now)) return `${shortDay(t)} ${time(t)}`
  return `${dayMonth(t)} ${time(t)}`
}

// "bugün 20:40", "yarın 01:10", "Pazar 10:00": a time written beside its day, so
// Turkish needs no suffix on a number. A day bearing today's name is next week's (a
// weekly reset falls on the same weekday it started): "haftaya Pazartesi 10:00", never
// read as today
export function dayTime(t: number, now: number): string {
  if (!Number.isFinite(t) || !Number.isFinite(now)) return '—'
  if (isSameDay(t, now)) return `bugün ${time(t)}`
  if (isSameDay(t, now + 24 * HOUR)) return `yarın ${time(t)}`
  if (t < now || t - now >= 8 * DAY) return `${dayMonth(t)} ${time(t)}`
  if (weekday(t) === weekday(now)) return `haftaya ${weekday(t)} ${time(t)}`
  if (t - now >= 6 * DAY) return `${dayMonth(t)} ${time(t)}`
  return `${weekday(t)} ${time(t)}`
}

export function headline(list: readonly Forecast[], now: number): { text: string; level: Level } | null {
  const lead = binding(list)
  if (!lead) return null
  if (lead.status === 'hit') {
    return { text: `Limite ulaşıldı. Kullanım ${dayTime(lead.resetsAt, now)} açılır.`, level: 2 }
  }
  if (lead.status === 'out') {
    const adj = WINDOWS[lead.kind]?.adj ?? lead.label
    // on too little of the window, said as the note under its bar says it
    return { text: `Bu hızla ${adj} limit, sıfırlanmadan (${dayTime(lead.resetsAt, now)}) önce dolacak${lead.isRough ? ' (tahmini)' : ''}.`, level: lead.level }
  }
  if (lead.level === 2) {
    return { text: `${lead.label} kotan dolmak üzere (%${leftOf(lead)} kaldı; sıfırlanma ${dayTime(lead.resetsAt, now)}).`, level: 2 }
  }
  if (lead.level === 1) {
    return { text: `${lead.label} kotanda %${leftOf(lead)} kaldı (sıfırlanma ${dayTime(lead.resetsAt, now)}).`, level: 1 }
  }
  return { text: `Yolundasın: kotan sıfırlanmaya (${dayTime(lead.resetsAt, now)}) kadar rahatça yeter.`, level: 0 }
}

/** Concise single-line headline for the detailed view's top bar. */
export function shortHeadline(list: readonly Forecast[], now: number): { text: string; level: Level } | null {
  const lead = binding(list)
  if (!lead) return null
  if (lead.status === 'hit') {
    return { text: `Limite ulaşıldı · açılış ${shortClock(lead.resetsAt, now)}`, level: 2 }
  }
  if (lead.status === 'out') {
    const adj = WINDOWS[lead.kind]?.adj ?? lead.label
    return { text: `Bu hızla ${adj} limit sıfırlanmadan dolar${lead.isRough ? ' (tahmini)' : ''}`, level: lead.level }
  }
  if (lead.level === 2) {
    return { text: `${lead.label} dolmak üzere · %${leftOf(lead)} kaldı`, level: 2 }
  }
  if (lead.level === 1) {
    return { text: `${lead.label} %${leftOf(lead)} kaldı · sıfırlama ${shortClock(lead.resetsAt, now)}`, level: 1 }
  }
  return { text: 'Kotan sıfırlanmaya kadar rahatça yeter', level: 0 }
}

/** The binding window in one line: what is left, and why that one. */
export function bindingLine(f: Forecast, now: number): string {
  if (f.status === 'hit') return `Etkin kalan %0: ${f.label} dolu, açılış ${dayTime(f.resetsAt, now)}`
  if (f.status === 'out') return `Etkin kalan %${leftOf(f)}: ${f.label} önce dolar, ${dayTime(f.runOutAt, now)}${f.isRough ? ' (tahmini)' : ''}`
  return `Etkin kalan %${leftOf(f)}: önce ${f.label} bağlar`
}

// a space a wrap never breaks at
export const NB = ' '
const whole = (s: string) => s.replace(/ /g, NB)

/** The line under a window's bar: what it comes to at this pace, and when it resets. */
export function noteOf(f: Forecast, now: number): string {
  if (f.status === 'idle') return 'bir sonraki mesajınla başlar'
  // held together when the note wraps: "3g 7sa sonra sıfırlanır" moves down whole
  const left = whole(`${duration(f.resetsAt - now)} sonra sıfırlanır`)
  const rough = f.isRough ? `${NB}(tahmini)` : ''
  if (f.status === 'hit') return `Limite ulaşıldı – ${left}`
  if (f.status === 'out') {
    return `Bu hızla sıfırlanmadan önce dolar: ${whole(dayTime(f.runOutAt, now))} ${whole(`(${duration(f.runOutAt - now)} sonra)`)}${rough} – ${left}`
  }
  return `Bu hızla sıfırlanmaya kadar en çok %${shownPercent(Math.min(100, f.projected))}${rough} – ${left}`
}

/** Concise single-line subtitle under a Claude window's remaining bar. */
export function detailNoteOf(f: Forecast, now: number): string {
  if (f.status === 'idle') return 'Sonraki mesajla başlar'
  const reset = `${whole(shortClock(f.resetsAt, now))} (${whole(spaceDuration(f.resetsAt - now))})`
  if (f.status === 'hit') return `Tükendi · açılış ${reset}`
  const rough = f.isRough ? `${NB}(tahmini)` : ''
  if (f.status === 'out') {
    return `Bitiş ~${whole(shortClock(f.runOutAt, now))}${rough} · sıfırlama ${reset}`
  }
  const endLeft = 100 - shownPercent(Math.min(100, f.projected))
  if (endLeft < leftOf(f)) {
    return `Dönem sonu ~%${endLeft} kalan${rough} · sıfırlama ${reset}`
  }
  return `Sıfırlama ${reset}`
}

/** The forecast tick's percent, or none when there is nothing ahead to mark. */
export function markerOf(f: Forecast): number | undefined {
  if (f.status === 'hit' || f.status === 'idle') return undefined
  if (!Number.isFinite(f.projected) || !Number.isFinite(f.percent)) return undefined
  const at = Math.min(100, Math.max(0, f.projected))
  return at - f.percent >= 1 ? at : undefined
}

/** The forecast tick's position on a remaining bar (0..100). */
export function leftMarkerOf(f: Forecast): number | undefined {
  if (f.status === 'hit' || f.status === 'idle') return undefined
  if (!Number.isFinite(f.projected) || !Number.isFinite(f.percent)) return undefined
  const at = Math.min(100, Math.max(0, f.projected))
  if (at - f.percent < 1) return undefined
  return Math.max(0, 100 - at)
}

/** An early warning worth a toast: it runs out well before it resets, on enough data. */
export function isEarly(f: Forecast): boolean {
  return f.status === 'out' && !f.isRough && f.runOutAt < f.resetsAt - 15 * MINUTE
}

export function earlyText(f: Forecast, now: number): string {
  const adj = WINDOWS[f.kind]?.adj ?? f.label
  return `Erken bitiş uyarısı: bu hızla ${adj} limit ${dayTime(f.runOutAt, now)} civarı dolar; sıfırlanma ${dayTime(f.resetsAt, now)}.`
}
