// The auto compact % a chat opens with, and the one pass that moves old defaults to it.
// Earlier versions opened chats at 40% (then 80%). A chat whose % nobody ever set by
// hand is moved to the current default (75%) once; one set by hand is never touched.
//
// "Set by hand" is read from what is kept, and when in doubt a chat counts as set by hand:
// - the store's `kaynak` ('elle' or 'varsayılan') is written since v0.x. Before it, the
//   store was written only by a press (here, or taken over from piksel-ofis) or a /clear
//   carrying one: a store record without `kaynak` is a person's choice.
// - the shared file's `t` is the time of a press (this band or piksel-ofis). A `t` of 0
//   is not a default by itself: earlier versions mirrored the store's (pressed) % into a
//   chat's missing shared file with `t` 0. So a `t` 0 file is a default only at a % the
//   band ever opened chats with (40, 80, or 75); other values (60, 70, 85, 90) were pressed.
import type { EngineInterface } from 'claude-code'

import { configDir, dataDir, get as keepGet, set as keepSet } from './kalici'
import { readShared, writeShared } from './shared'

/** The % whenever a chat has none of its own: a first switch-on, a new chat. */
export const AT_DEFAULT = 75
/** Earlier default % (40 from usage-quota / early band, 80 before 75): the ones the pass moves. */
export const AT_OLD_DEFAULT = 40
export const OLD_DEFAULTS: ReadonlySet<number> = new Set([AT_OLD_DEFAULT, 80])

/** Who set a chat's auto compact: a press (here or in piksel-ofis), or the band itself. */
export type Source = 'elle' | 'varsayılan'
export const BY_HAND: Source = 'elle'
export const BY_DEFAULT: Source = 'varsayılan'

/** What the store keeps for a chat: the setting and who set it (absent before this version). */
export type StoredAuto = { isOn: boolean; at: number | null; kaynak?: Source }

export function storedOf(v: unknown): StoredAuto | undefined {
  const a = v as Partial<StoredAuto> | undefined
  if (!a || typeof a !== 'object' || typeof a.isOn !== 'boolean') return undefined
  const kaynak = a.kaynak === BY_HAND || a.kaynak === BY_DEFAULT ? a.kaynak : undefined
  const at = typeof a.at === 'number' && Number.isFinite(a.at) ? a.at : null
  return { isOn: a.isOn, at, ...(kaynak ? { kaynak } : {}) }
}

/** Who set a store record: one kept before `kaynak` was written came from a press. */
export const storedSource = (stored: StoredAuto): Source => stored.kaynak ?? BY_HAND

/** Who set a shared file: a press has its time; `t` 0 is a default only at a known default %. */
export function sharedSource(shared: { at: number; t: number }): Source {
  if (Number.isFinite(shared.t) && shared.t > 0) return BY_HAND
  if (!Number.isFinite(shared.at)) return BY_HAND
  return shared.at === AT_DEFAULT || OLD_DEFAULTS.has(shared.at) ? BY_DEFAULT : BY_HAND
}

// the pass is done once per default generation: bumping DONE re-runs once on upgrade
export const DONE_KEY = 'esikGecisi'
const DONE = 2
const SHARED_FOLDER = 'claude-auto-compact'
const KEY_PREFIX = 'autoCompact:'
const FILE_PREFIX = encodeURIComponent(KEY_PREFIX)

async function chatsOnDisk($: EngineInterface): Promise<string[]> {
  const ids: string[] = []
  const config = await configDir($)
  if (config) {
    try {
      for (const f of await $.fs.list(`${config}/plugins/data/${SHARED_FOLDER}`)) {
        if (f.kind === 'file' && f.name.endsWith('.json')) ids.push(f.name.slice(0, -'.json'.length))
      }
    } catch {
      // no shared folder yet: nothing kept there
    }
  }
  const dir = await dataDir($)
  if (dir) {
    try {
      for (const f of await $.fs.list(`${dir}/depo`)) {
        if (f.kind !== 'file' || !f.name.startsWith(FILE_PREFIX) || !f.name.endsWith('.json')) continue
        try {
          ids.push(decodeURIComponent(f.name.slice(0, -'.json'.length)).slice(KEY_PREFIX.length))
        } catch {
          // a name that is not one of ours
        }
      }
    } catch {
      // no fallback files: the store held everything
    }
  }
  return ids
}

async function chatsInStore($: EngineInterface): Promise<string[]> {
  try {
    return (await $.store.keys()).filter(k => k.startsWith(KEY_PREFIX)).map(k => k.slice(KEY_PREFIX.length))
  } catch {
    // a broken store lists nothing: its chats are in the files above
    return []
  }
}

/**
 * Once: every chat whose % was never set by hand and sits at an old default (40 or 80) goes
 * to the current default (whether on or off; only the % moves). Returns how many chats moved.
 */
export async function raiseDefaults($: EngineInterface): Promise<number> {
  if ((await keepGet($, DONE_KEY)) === DONE) return 0
  const chats = new Set([...(await chatsOnDisk($)), ...(await chatsInStore($))].filter(id => id.length > 0))
  let moved = 0
  for (const chat of chats) {
    const shared = await readShared($, chat)
    const stored = storedOf(await keepGet($, `${KEY_PREFIX}${chat}`))
    // a press in either place wins; the store says who set it when it holds the chat,
    // else the shared file does; a chat with neither is not one to move
    const isPressed = shared !== undefined && Number.isFinite(shared.t) && shared.t > 0
    const source = stored ? storedSource(stored) : shared ? sharedSource(shared) : undefined
    if (isPressed || source !== BY_DEFAULT) continue
    let isMoved = false
    if (shared && OLD_DEFAULTS.has(shared.at)) {
      await writeShared($, chat, { isOn: shared.isOn, at: AT_DEFAULT, t: 0 })
      isMoved = true
    }
    if (stored && stored.at !== null && OLD_DEFAULTS.has(stored.at)) {
      await keepSet($, `${KEY_PREFIX}${chat}`, { isOn: stored.isOn, at: AT_DEFAULT, kaynak: BY_DEFAULT })
      isMoved = true
    }
    if (isMoved) moved += 1
  }
  await keepSet($, DONE_KEY, DONE)
  if (moved > 0) $.ui.log(`kota-bandi: ${moved} sohbetin varsayılan otomatik sıkıştırma eşiği %${AT_DEFAULT}'e çekildi`, { to: 'debug' })
  return moved
}
