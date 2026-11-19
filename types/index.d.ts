export type Category = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
/** the usual final %, the one-off % left out of the pace, and how many past windows the usual one rests on */
export type PaceOf = { typical: number; skip: number; n?: number }
/**
 * Cetvel's forecast of a window (EWMA of its samples): the pace in % of the window an
 * hour, the reset it was worked out for, and whether past its trial ('hazir') or still
 * 'deneysel'. Preferred over the band's own pace while the service answers.
 */
export type Ewma = { ratePerHour: number; resetsAt: string; isReady: boolean }
export type Snapshot = {
  window: number
  tokens: number
  percent: number
  total: number
  categories: Category[]
  limits: Limit[]
  /** when the limit figures were read */
  limitsAt?: number
  /** why the usage service last refused, while it is backed off */
  limitsError?: string
  /** per window kind: the usual final % and the one-off % left out of the pace */
  pace?: Record<string, PaceOf>
  /** per window kind: Cetvel's EWMA pace, when it runs and has one for this window */
  ewma?: Record<string, Ewma>
  /** the minute it was taken in: redraws countdowns at least once a minute */
  minute?: number
}

/** auto compact: on or off, and the context % that sets it off (kept for every chat) */
export type AutoCompact = { isOn: boolean; at: number | null }

/** what holds auto compact back in a chat: an ask (or "after my next compact"), or a compaction that left it past the % */
export type Hold = { chat: string; waits: boolean; stuck: boolean }

/** how the band shows: everything, one row, or only a small button by the prompt */
export type Mode = 'detayli' | 'kisa' | 'gizli'
/** the mode, and the last open one the small button goes back to */
export type View = { mode: Mode; last: 'detayli' | 'kisa' }

/** the original usage-quota mod: not there, turned on in the settings, or still loaded in an open chat */
export type Original = { state: 'none' | 'enabled' | 'live'; id: string }

/** whether a chat's first turn here has started (the reopened chat's one-off jump is measured from it) */
export type Opening = { chat: string; done: boolean }

/** one window of another platform from Cetvel */
export type OtherWindow = {
  key: string
  label: string
  percent: number
  left: number
  level: 0 | 1 | 2
  resetsAt?: number
}

/** one other platform from Cetvel: all active windows and its tightest summary */
export type OtherPlatform = {
  id: string
  name: string
  percent: number
  left: number
  window: string
  resetsAt?: number
  windows: OtherWindow[]
  isStale: boolean
  level: 0 | 1 | 2
}

declare module 'claude-code' {
  interface PluginState {
    'kota-bandi': {
      snapshot: Snapshot | null
      isOn: boolean
      view: View
      autoCompact: AutoCompact
      /** the choice the band is asking for: the context was already past a new % */
      autoAsk: { at: number; percent: number } | null
      hold: Hold
      original: Original
      /** the other platforms Cetvel reads, while it runs */
      others: { others: OtherPlatform[]; isStale: boolean } | null
      opening: Opening
    }
  }
}
