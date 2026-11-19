// What the band keeps between chats and restarts. The engine's store is the first
// home; it is a JSON file the engine writes without a safe replace, and once it was
// found full of NUL bytes: every read came back empty and every write failed, unseen.
// So the store is tried once at the start (a write, then a read back) and, while it
// fails, each key goes to a small file of its own under plugins/data/kota-bandi/depo
// instead (one file a key, so two chats never rewrite each other's keys). A value this
// chat set is also held in memory: even with both gone, the chat keeps what it chose.
import type { EngineInterface } from 'claude-code'

export type Health = 'unknown' | 'sound' | 'broken'

let health: Health = 'unknown'
let base: string | null | undefined = null
const memory = new Map<string, unknown>()
let onBroken: (() => void) | undefined

/** Called once each time the store is found broken (the band says so in one toast). */
export function whenBroken(fn: () => void): void {
  onBroken = fn
}

export function healthOf(): Health {
  return health
}

export async function configDir($: EngineInterface): Promise<string | undefined> {
  try {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined)
    return config?.replace(/\\/g, '/').replace(/\/$/, '')
  } catch {
    return undefined
  }
}

/** plugins/data/kota-bandi: this band's own files (the kept keys, a few markers). */
export async function dataDir($: EngineInterface): Promise<string | undefined> {
  if (base !== null) return base
  const config = await configDir($)
  base = config ? `${config}/plugins/data/kota-bandi` : undefined
  return base
}

// a key as a file name, reversibly: "autoCompact:abc" -> "autoCompact%3Aabc"
const fileOf = (key: string) => `${encodeURIComponent(key).replace(/\*/g, '%2A')}.json`
const keyOf = (file: string) => decodeURIComponent(file.replace(/\.json$/, ''))

function markBroken(): void {
  if (health === 'broken') return
  health = 'broken'
  onBroken?.()
}

/**
 * A write and a read back: whether the engine's store keeps what it is given. The key
 * is this probe's own (every chat shares the store: chats opening together would read
 * each other's mark under one key), and it is removed after.
 */
async function probeOnce($: EngineInterface, now: number): Promise<boolean> {
  const token = `${now}-${Math.random().toString(36).slice(2)}`
  const key = `__sonda:${token}`
  try {
    await $.store.set(key, token)
    const isSound = (await $.store.get(key)) === token
    try {
      await $.store.delete(key)
    } catch {
      // a leftover mark is harmless
    }
    return isSound
  } catch {
    return false
  }
}

export async function probe($: EngineInterface, now: number): Promise<Health> {
  // one refusal can be a moment's clash with another chat writing: once more first
  // (straight away: a hook's sleep counts against its budget)
  const isSound = (await probeOnce($, now)) || (await probeOnce($, now + 1))
  if (!isSound) markBroken()
  else if (health === 'broken') {
    // working again: what was kept in files goes back into the store
    health = 'sound'
    await restore($)
  } else health = 'sound'
  return health
}

async function restore($: EngineInterface): Promise<void> {
  const dir = await dataDir($)
  if (!dir) return
  try {
    for (const f of await $.fs.list(`${dir}/depo`)) {
      if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
      try {
        const key = keyOf(f.name)
        const value = await readFile($, `${dir}/depo/${f.name}`)
        if (value !== undefined) await $.store.set(key, value)
      } catch {
        // one malformed filename or write error leaves the rest to recover
      }
    }
  } catch {
    // the files stay where they are; the next probe tries again
  }
}

async function readFile($: EngineInterface, path: string): Promise<unknown> {
  try {
    const raw = await $.fs.read(path)
    const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
    const trimmed = text.trim()
    if (!trimmed || trimmed.includes('\0')) return undefined
    const held = JSON.parse(trimmed) as unknown
    return held && typeof held === 'object' && !Array.isArray(held) ? (held as { v?: unknown }).v : undefined
  } catch {
    return undefined
  }
}

export async function get($: EngineInterface, key: string): Promise<unknown> {
  if (health !== 'broken') {
    try {
      const value = await $.store.get(key)
      if (value !== undefined) return value
      if (memory.has(key)) return memory.get(key)
    } catch {
      markBroken()
    }
  }
  const dir = await dataDir($)
  const value = dir ? await readFile($, `${dir}/depo/${fileOf(key)}`) : undefined
  return value === undefined ? memory.get(key) : value
}

/** Keeps `value` under `key`; false when nothing but this chat's memory took it. */
export async function set($: EngineInterface, key: string, value: unknown): Promise<boolean> {
  memory.set(key, value)
  if (health !== 'broken') {
    try {
      await $.store.set(key, value)
      return true
    } catch {
      markBroken()
    }
  }
  const dir = await dataDir($)
  if (!dir) return false
  try {
    await $.fs.write(`${dir}/depo/${fileOf(key)}`, JSON.stringify({ v: value }))
    return true
  } catch {
    return false
  }
}
