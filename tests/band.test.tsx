import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { On, SessionRateLimit, SessionUsage } from 'claude-code'

import { fitOthers, leftShown, OTHER_LEAD, otherFull, poolModels, poolResetWindow, poolSlots, readSnapshot, reset as cetvelReset, viewOf, type Other } from '../hooks/cetvel'
import { dayTime, duration, forecast, headline, leftMarkerOf, markerOf, shortClock, shortHeadline } from '../hooks/tahmin'

const NOW = Date.parse('2026-10-04T06:00:00Z')
const SEC = 1_000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const SURFACES = ['terminal', 'desktop'] as const
const NB = '\u00a0'
const CONFIG = 'C:/ev/.claude'
const LINK = 'C:/yerel/Cetvel/baglanti.json'
const TOKEN = 'a1'.repeat(32)

const PROPS = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 40,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const CATEGORIES = [
  { name: 'System prompt', tokens: 4_000, kind: 'used' },
  { name: 'System tools', tokens: 34_000, kind: 'used' },
  { name: 'MCP tools', tokens: 17_000, kind: 'used' },
  { name: 'Skills', tokens: 6_000, kind: 'used' },
  { name: 'Messages', tokens: 97_000, kind: 'used' },
  { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
  { name: 'Free space', tokens: 808_000, kind: 'free' },
].map(c => ({ color: 'text', isDeferred: false, ...c }))

function usage(rateLimits: SessionRateLimit[]): SessionUsage {
  return {
    startedAt: NOW - HOUR,
    context: {
      window: 1_000_000,
      tokens: 158_000,
      percent: 16,
      breakdown: { categories: CATEGORIES, totalTokens: 159_000, maxTokens: 1_000_000, rawMaxTokens: 1_000_000, percentage: 16 } as never,
    },
    rateLimits,
  }
}

const iso = (ms: number) => new Date(NOW + ms).toISOString()

type World = {
  clock: ReturnType<typeof mock.clock>
  store: Map<string, unknown>
  files: Record<string, string>
  times: Record<string, number>
  toasts: string[]
  fetches: { url: string; method: string; body?: string; auth?: string }[]
  asks: number
  logs: string[]
}

type Options = {
  /** 'broken': reads come back empty and writes fail, as the NUL-filled store did */
  store?: 'sound' | 'broken'
  isStoreBroken?: () => boolean
  entries?: Record<string, unknown>
  files?: Record<string, string>
  times?: Record<string, number>
  /** no file system at all: every read and write refused */
  noDisk?: boolean
  plugins?: Record<string, boolean>
  /** Cetvel's answers by path; absent, no service runs */
  cetvel?: (path: string, method: string, body?: string) => { status: number; text?: string; headers?: Record<string, string> }
  /** true: this read of the session's usage fails */
  failUsage?: () => boolean
  /** another chat probing the store at the same moment: the shared key holds its mark, and the first write clashes */
  probeClash?: boolean
}

// what the engine answers beneath the plugin: no first-party login, its own empty band
function world(on: On, rateLimits: SessionRateLimit[], o: Options = {}): World {
  const w: World = { clock: mock.clock(on, { now: NOW }), store: new Map(Object.entries(o.entries ?? {})), files: { ...(o.files ?? {}) }, times: { ...(o.times ?? {}) }, toasts: [], fetches: [], asks: 0, logs: [] }
  mock.env(on, { USERPROFILE: 'C:/ev', LOCALAPPDATA: 'C:/yerel' })
  const isBroken = () => o.store === 'broken' || Boolean(o.isStoreBroken?.())
  let isClashed = false
  on('store.get', (_, e) => ({ value: isBroken() ? undefined : o.probeClash && e.key === '__sonda' ? 'baska-sohbet' : w.store.get(e.key) }))
  on('store.set', (_, e) => {
    if (isBroken()) return { deny: 'depo yazılamadı' }
    if (o.probeClash && !isClashed) {
      isClashed = true
      return { deny: 'EBUSY' }
    }
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => (isBroken() ? { deny: 'depo okunamadı' } : { value: [...w.store.keys()] }))
  on('store.delete', (_, e) => {
    if (isBroken()) return { deny: 'depo yazılamadı' }
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // the engine hands the hooks a path in the system's own spelling (C:\...): kept here with /
  const slash = (path: string) => path.replace(/\\/g, '/')
  on('fs.read', (_, e) => (!o.noDisk && slash(e.path) in w.files ? { value: w.files[slash(e.path)]! } : { deny: 'ENOENT' }))
  on('fs.write', (_, e) => {
    if (o.noDisk) return { deny: 'EACCES' }
    w.files[slash(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    if (o.noDisk) return { deny: 'ENOENT' }
    const dir = `${slash(e.path).replace(/\/$/, '')}/`
    const names = Object.keys(w.files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file' as const, size: w.files[p]!.length, mtimeMs: w.times[p] ?? NOW - HOUR, isLink: false })) }
  })
  on('settings.read', () => ({ value: { enabledPlugins: { 'kota-bandi@yerel-modlar': true, ...(o.plugins ?? {}) } } as never }))
  on('http.fetch', (_, e) => {
    const auth = e.init?.headers?.authorization
    w.fetches.push({ url: e.url, method: e.init?.method ?? 'GET', ...(e.init?.body !== undefined ? { body: String(e.init.body) } : {}), ...(auth ? { auth } : {}) })
    const m = /^http:\/\/127\.0\.0\.1:43117(\/[^?]*)/.exec(e.url)
    if (!m || !o.cetvel) return { deny: 'ECONNREFUSED' }
    const r = o.cetvel(m[1]!, e.init?.method ?? 'GET', e.init?.body !== undefined ? String(e.init.body) : undefined)
    return { value: { status: r.status, ok: r.status >= 200 && r.status < 300, headers: r.headers ?? {}, text: r.text ?? '' } }
  })
  on('session.usage', () => (o.failUsage?.() ? { deny: 'okunamadı' } : { value: usage(rateLimits) }))
  on('session.id', () => ({ value: 'sohbet-1' }))
  on('session.authorize', () => {
    w.asks += 1
    return { value: null }
  })
  on('session.measure', () => ({ changed: [] }))
  on('command.register', () => ({ value: { command: 'kota' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', (_, e) => {
    w.logs.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  return w
}

const MEASURE = { context: { window: 1_000_000, tokens: 158_000, percent: 16 }, rateLimits: [], changed: [] }
const ON_TRACK: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 8, resetsAt: iso(3 * HOUR + 24 * MIN) },
  { kind: 'seven_day', percentUsed: 46, resetsAt: iso(3 * 24 * HOUR + 7 * HOUR) },
]
const RUNS_OUT: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 70, resetsAt: iso(4 * HOUR) },
  { kind: 'seven_day', percentUsed: 46, resetsAt: iso(3 * 24 * HOUR) },
]

test('the band speaks Turkish on every surface', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: 'Kotan sıfırlanmaya kadar rahatça yeter' })).toBeDefined()
    expect(await ui.find({ text: '%16 dolu' })).toBeDefined()
    expect(await ui.find({ text: '· 809k boş' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Mesajlar' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Araçlar' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Diğer' })).toBeDefined()
    expect(await ui.find({ text: '5 saat' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Haftalık$/ })).toBeDefined()
    expect(await ui.find({ text: '%92 kalan' })).toBeDefined()
    expect(await ui.find({ text: '%54 kalan' })).toBeDefined()
    // the weekly window is past half way: a firm forecast; the 5 hour one is early: "tahmini"
    expect(await ui.find({ text: new RegExp(`^Dönem sonu ~%19 kalan · sıfırlama .+ \\(3${NB}g${NB}7${NB}sa\\)$`) })).toBeDefined()
    expect(await ui.find({ text: new RegExp(`^Dönem sonu ~%\\d+ kalan${NB}\\(tahmini\\) · sıfırlama `) })).toBeDefined()
    // no repetitive "Etkin kalan" summary line in the detailed view
    expect(await ui.find({ text: /^Etkin kalan/ })).toBeUndefined()
    expect(await ui.find({ text: /used|free of|On track|Weekly|resets in|Max|Plus|Pro\b/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'hide' })).toBeDefined()
    if (surface === 'desktop') {
      const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
      expect(alts.some(a => /^5 saat %92 kalan/.test(a))).toBe(true)
      expect(alts.some(a => /^Bağlam %16 dolu/.test(a))).toBe(true)
    }
    await ui.unmount()
  }
})

test('the threshold steps by five and shows whole', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    const before = Number((await ui.find({ type: 'Text', text: /^%\d+$/ }))?.text.slice(1))
    await ui.press({ key: 'autoUp' })
    expect(await ui.find({ type: 'Text', text: `%${before + 5}` })).toBeDefined()
    await ui.press({ key: 'autoDown' })
    await ui.press({ key: 'autoDown' })
    expect(await ui.find({ type: 'Text', text: `%${before - 5}` })).toBeDefined()
    await ui.press({ key: 'autoUp' })
    await ui.unmount()
  }
})

test('the stepper stops at its ends, and the default stays 75', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.measure(MEASURE)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: '%75' })).toBeDefined()
  for (let i = 0; i < 20; i++) await ui.press({ key: 'autoUp' })
  expect(await ui.find({ type: 'Text', text: '%95' })).toBeDefined()
  for (let i = 0; i < 30; i++) await ui.press({ key: 'autoDown' })
  expect(await ui.find({ type: 'Text', text: '%15' })).toBeDefined()
  for (let i = 0; i < 12; i++) await ui.press({ key: 'autoUp' })
  await ui.unmount()
})

test('a pace that runs out says when, in Turkish, short view too', async ($, on) => {
  world(on, RUNS_OUT)
  await $.session.measure(MEASURE)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // an hour into the window: the headline says "tahmini" and warns cleanly
  expect(await ui.find({ text: /^Bu hızla 5 saatlik limit sıfırlanmadan dolar \(tahmini\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '▲' })).toBeDefined()
  // the hour it runs out, "tahmini", and the reset time + duration
  expect(await ui.find({ text: new RegExp(`^Bitiş ~\\d\\d:\\d\\d${NB}\\(tahmini\\) · sıfırlama \\d\\d:\\d\\d \\(4${NB}sa\\)$`) })).toBeDefined()
  expect(await ui.find({ text: '%30 kalan' })).toBeDefined()
  await ui.press({ key: 'collapse' })
  expect(await ui.find({ type: 'Text', text: '5 Saat' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Hafta$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '%70' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'collapse' })).toMatchObject({ props: { label: '▲' } })
  await ui.unmount()
})

test('three modes: detailed, short, hidden, and back to the last open one', async ($, on) => {
  const w = world(on, ON_TRACK)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: /^Haftalık$/ })).toBeDefined()
    // hidden from detailed: only the small button is left, and it opens detailed again
    await ui.press({ key: 'hide' })
    expect(await ui.find({ type: 'Button', key: 'show' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Haftalık$/ })).toBeUndefined()
    expect(await ui.find({ text: /Bağlam/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeUndefined()
    expect(w.store.get('view')).toMatchObject({ mode: 'gizli', last: 'detayli' })
    await ui.press({ key: 'show' })
    expect(await ui.find({ type: 'Text', text: /^Haftalık$/ })).toBeDefined()
    // hidden from short: back to short
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ type: 'Text', text: /^Hafta$/ })).toBeDefined()
    await ui.press({ key: 'hide' })
    expect(await ui.find({ type: 'Button', key: 'show' })).toBeDefined()
    await ui.press({ key: 'show' })
    expect(await ui.find({ type: 'Text', text: /^Hafta$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Haftalık$/ })).toBeUndefined()
    expect(w.store.get('view')).toMatchObject({ mode: 'kisa', last: 'kisa' })
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ type: 'Text', text: /^Haftalık$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the hidden button tells the tightest limit in its tip', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'hide' })
  const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
  expect(alts).toEqual(['Kota bandını göster. En dar limit: Haftalık %46 · bağlam %16'])
  expect(await ui.find({ text: 'En dar limit: Haftalık %46 · bağlam %16' })).toBeDefined()
  await ui.unmount()
})

test('a mode set in another chat is taken over, a press is never undone', async ($, on) => {
  const w = world(on, ON_TRACK)
  const clock = w.clock
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  // another chat folds the band
  w.store.set('view', { mode: 'kisa', last: 'kisa', t: NOW + 1 })
  await clock.advance(2 * SEC)
  expect(await ui.find({ type: 'Text', text: /^Hafta$/ })).toBeDefined()
  // a press here is newer than what the store holds: it stays, look after look
  await ui.press({ key: 'collapse' })
  await clock.advance(5 * SEC)
  expect(await ui.find({ type: 'Text', text: /^Haftalık$/ })).toBeDefined()
  // an older record turning up later changes nothing
  w.store.set('view', { mode: 'gizli', last: 'kisa', t: NOW + 1 })
  await clock.advance(3 * SEC)
  expect(await ui.find({ type: 'Text', text: /^Haftalık$/ })).toBeDefined()
  await ui.unmount()
})

test('▼ stays folded when the store is broken (regression)', async ($, on) => {
  const w = world(on, ON_TRACK, { store: 'broken' })
  const clock = w.clock
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // the band says once that the store is broken, in Turkish
  expect(w.toasts.filter(t => /ayar deposu bozuk/.test(t))).toHaveLength(1)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ type: 'Button', key: 'collapse' })).toMatchObject({ props: { label: '▲' } })
    // 0.4 opened it again within half a second; now it holds through every look
    await clock.advance(1_200)
    await clock.advance(10 * SEC)
    expect(await ui.find({ type: 'Button', key: 'collapse' })).toMatchObject({ props: { label: '▲' } })
    expect(await ui.find({ type: 'Text', text: /^Hafta$/ })).toBeDefined()
    await ui.press({ key: 'collapse' })
    await clock.advance(3 * SEC)
    expect(await ui.find({ type: 'Button', key: 'collapse' })).toMatchObject({ props: { label: '▼' } })
    await ui.unmount()
  }
  // what the store could not keep went to the band's own file
  expect(JSON.parse(w.files[`${CONFIG}/plugins/data/kota-bandi/depo/view.json`]!)).toMatchObject({ v: { mode: 'detayli' } })
})

test('▼ stays folded with no store and no disk either', async ($, on) => {
  const { clock } = world(on, ON_TRACK, { store: 'broken', noDisk: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'hide' })
  await clock.advance(6 * SEC)
  expect(await ui.find({ type: 'Button', key: 'show' })).toBeDefined()
  await ui.unmount()
})

test("0.3's folded band opens folded", async ($, on) => {
  world(on, ON_TRACK, { entries: { collapsed: true } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /^Hafta$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Haftalık$/ })).toBeUndefined()
  await ui.unmount()
})

test('/kota picks a mode by name', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(await $.command.run({ command: 'kota', args: 'gizli' } as never)).toMatchObject({ text: 'Kota bandı: gizli görünüm.' })
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Button', key: 'show' })).toBeDefined()
  await ui.unmount()
  expect(await $.command.run({ command: 'kota', args: 'Detaylı' } as never)).toMatchObject({ text: 'Kota bandı: detaylı görünüm.' })
  expect((await $.command.run({ command: 'kota', args: 'yok' } as never))?.text).toMatch(/^Kullanım: \/kota/)
})

test('the original usage-quota turned on: one line saying how to turn it off', async ($, on) => {
  world(on, ON_TRACK, { plugins: { 'usage-quota@claude-code-usage-quota-mod': true } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: PROPS })
    const line = await ui.find({ text: /^İki kota bandı açık: özgün usage-quota modunu kapatın\./ })
    expect(line?.text).toContain('claude plugin uninstall usage-quota@claude-code-usage-quota-mod')
    expect(line?.text).toContain('/reload-plugins')
    await ui.unmount()
  }
})

test('the original off in the settings but still loaded: the same warning, with a reload', async ($, on) => {
  const store = `${CONFIG}/plugins/store/usage-quota_claude-code-usage-quota-mod-265bf7c6c647.json`
  world(on, ON_TRACK, { plugins: { 'usage-quota@claude-code-usage-quota-mod': false }, files: { [store]: '{}' }, times: { [store]: NOW - 2 * MIN } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /^İki kota bandı açık: özgün usage-quota ayarda kapalı ama açık bir sohbette hâlâ yüklü\. Açık sohbetlerde \/reload-plugins/ })).toBeDefined()
  await ui.unmount()
})

test('the original off and long quiet: no warning, and the band never turns it on', async ($, on) => {
  const store = `${CONFIG}/plugins/store/usage-quota_claude-code-usage-quota-mod-265bf7c6c647.json`
  const w = world(on, ON_TRACK, { plugins: { 'usage-quota@claude-code-usage-quota-mod': false }, files: { [store]: '{"pace":{"finals":{},"windows":{}}}' }, times: { [store]: NOW - 3 * HOUR } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /İki kota bandı/ })).toBeUndefined()
  await ui.unmount()
  // its old store is only read, and no settings file is ever written
  expect(w.files[store]).toBe('{"pace":{"finals":{},"windows":{}}}')
  expect(Object.keys(w.files).some(p => /settings|installed_plugins|marketplaces/.test(p))).toBe(false)
})

const SNAPSHOT = {
  sema: 2,
  yazan: 'cetvel',
  zaman: iso(0),
  sira: 7,
  havuzlar: {
    claude_max: {
      platform: 'claude', etiket: 'Claude Max', durum: 'ok',
      kaynak: { tur: 'mod_koprusu', okuma: iso(-30 * SEC), yas_sn: 30 },
      pencereler: { '5s': { uzunluk_dk: 300, kullanilan: 0.08, kalan: 0.92, sifirlama: iso(3 * HOUR + 24 * MIN) } },
    },
    codex_plus: {
      platform: 'codex', etiket: 'Codex Plus', durum: 'ok', kaynak: { yas_sn: 40 },
      pencereler: { '5s': { uzunluk_dk: 300, kullanilan: 0.1, kalan: 0.9 }, hafta: { uzunluk_dk: 10080, kullanilan: 0.16, kalan: 0.84 } },
    },
    agy_gemini: { platform: 'agy', etiket: 'Antigravity Pro', durum: 'ok', kaynak: { yas_sn: 50 }, pencereler: { '5s': { uzunluk_dk: 300, kullanilan: 0.77, kalan: 0.23 } } },
    agy_claude_gpt: { platform: 'agy', etiket: 'Antigravity Ultra', durum: 'ok', kaynak: { yas_sn: 50 }, pencereler: { '5s': { uzunluk_dk: 300, kullanilan: 0.53, kalan: 0.47 } } },
    agy_argon: { platform: 'agy', etiket: 'Argon Max', durum: 'ok', kaynak: { yas_sn: 50 }, pencereler: { hafta: { uzunluk_dk: 10080, kullanilan: 0.03, kalan: 0.97 } } },
    deepseek: { platform: 'deepseek', durum: 'baglanmadi' },
  },
}

function service(lease: number) {
  const seen: { path: string; method: string; body?: string }[] = []
  const answer = (path: string, method: string, body?: string) => {
    seen.push({ path, method, ...(body !== undefined ? { body } : {}) })
    if (path === '/v1/anlik') return { status: 200, text: JSON.stringify(SNAPSHOT), headers: { etag: '"7"' } }
    if (path === '/v1/claude/kira') return { status: lease, text: '{}' }
    if (path === '/v1/claude') return { status: 200, text: '{}' }
    return { status: 404 }
  }
  return { seen, answer }
}

test('with Cetvel: the other platforms as separate rows, no plan names, the token only to loopback', async ($, on) => {
  const cetvel = service(200)
  const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN, pipe: 'x', surum: '0.1.0', adresler: ['http://kotu.example'] }) }, cetvel: cetvel.answer })
  const clock = w.clock
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(6 * SEC)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: 'Diğer platformlar' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '· kalan' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Codex' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '%90' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '%84' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Antigravity · Gemini' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '%23' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Antigravity · Claude/GPT' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '%47' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Antigravity · Argon' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '%97' })).toBeDefined()
    // what is used (16, 77, 53, 3) is never the figure shown
    expect(await ui.find({ type: 'Text', text: /^%(16|77|53|3)$/ })).toBeUndefined()
    expect(await ui.find({ text: /Claude Max|Codex Plus|Gemini Pro|DeepSeek|Plus|Max|Ultra|\bPro\b/ })).toBeUndefined()
    await ui.unmount()
  }
  // the figures this chat read went to the service, as the reply reported them
  const sent = cetvel.seen.filter(s => s.path === '/v1/claude').map(s => JSON.parse(s.body!) as Record<string, unknown>)
  expect(sent.length).toBeGreaterThan(0)
  expect(sent[0]).toMatchObject({ kaynak: 'yanit_ratelimits', five_hour: { utilization: 8 }, seven_day: { utilization: 46 } })
  expect(String(sent[0]!.istemci)).toMatch(/^kota-bandi-[0-9a-z]+$/)
  // the token went only to 127.0.0.1, and nowhere on screen or in a toast
  for (const f of w.fetches.filter(f => f.auth)) expect(f.url.startsWith('http://127.0.0.1:43117/')).toBe(true)
  expect(w.fetches.some(f => f.url.includes('kotu.example'))).toBe(false)
  expect(w.toasts.some(t => t.includes(TOKEN))).toBe(false)
})

test('with Cetvel: a chat without the lease does not ask the usage service', async ($, on) => {
  const cetvel = service(409)
  const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) }, cetvel: cetvel.answer })
  const clock = w.clock
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(6 * SEC)
  const before = w.asks
  // the 2-minute ask comes due: the lease is another chat's
  await clock.advance(2 * MIN + 5 * SEC)
  expect(cetvel.seen.some(s => s.path === '/v1/claude/kira')).toBe(true)
  expect(w.asks).toBe(before)
})

test('with Cetvel: the chat holding the lease asks', async ($, on) => {
  const cetvel = service(200)
  const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) }, cetvel: cetvel.answer })
  const clock = w.clock
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(6 * SEC)
  const before = w.asks
  await clock.advance(2 * MIN + 5 * SEC)
  expect(w.asks).toBeGreaterThan(before)
})

test('without Cetvel the band works alone, quietly', async ($, on) => {
  const w = world(on, ON_TRACK)
  const clock = w.clock
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(40 * SEC)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /^Haftalık$/ })).toBeDefined()
  expect(await ui.find({ text: /Diğer platformlar|Cetvel/ })).toBeUndefined()
  await ui.unmount()
  expect(w.fetches.some(f => f.url.startsWith('http://127.0.0.1'))).toBe(false)
  expect(w.toasts.some(t => /Cetvel/.test(t))).toBe(false)
})

test('a broken Cetvel link file is left alone', async ($, on) => {
  const w = world(on, ON_TRACK, { files: { [LINK]: '\u0000'.repeat(64) }, cetvel: service(200).answer })
  const clock = w.clock
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(20 * SEC)
  expect(w.fetches.some(f => f.url.startsWith('http://127.0.0.1'))).toBe(false)
})

test('Cetvel going quiet greys the line, then it goes', async ($, on) => {
  let isUp = true
  const cetvel = service(200)
  const { clock } = world(on, ON_TRACK, {
    files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) },
    cetvel: (path, method, body) => (isUp ? cetvel.answer(path, method, body) : { status: 503 }),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(6 * SEC)
  isUp = false
  await clock.advance(30 * SEC)
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: '(Cetvel yanıt vermiyor)' })).toBeDefined()
  await ui.unmount()
  await clock.advance(11 * MIN)
  const later = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await later.find({ text: /Diğer platformlar/ })).toBeUndefined()
  await later.unmount()
})

test('every width draws, in every mode, numbers whole', async ($, on) => {
  world(on, RUNS_OUT)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of SURFACES) {
    for (const bodyColumns of [20, 34, 48, 60, 72, 77, 78, 84, 100, 160]) {
      const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns } })
      expect(await ui.find({ type: 'Text', text: /^%30( kalan)?$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '%75' })).toBeDefined()
      await ui.press({ key: 'collapse' })
      expect(await ui.find({ type: 'Text', text: '%70' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '%16' })).toBeDefined()
      await ui.press({ key: 'hide' })
      expect(await ui.find({ type: 'Button', key: 'show' })).toBeDefined()
      await ui.press({ key: 'show' })
      await ui.press({ key: 'collapse' })
      await ui.unmount()
    }
  }
})

test('a short room shows the short band, the setting kept', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, maxRows: 5 } })
  expect(await ui.find({ type: 'Text', text: /^Hafta$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'collapse' })).toMatchObject({ props: { label: '▼' } })
  await ui.unmount()
})

test('both windows full: the headline waits for the later reset', async ($, on) => {
  world(on, [
    { kind: 'five_hour', percentUsed: 100, resetsAt: iso(2 * HOUR) },
    { kind: 'seven_day', percentUsed: 100, resetsAt: iso(2 * 24 * HOUR) },
  ])
  await $.session.measure(MEASURE)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  // 06:00Z is 09:00 in Istanbul: the weekly opens two days on, not in two hours
  expect(await ui.find({ text: /^Limite ulaşıldı · açılış \S+ \d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ text: '%0 kalan' })).toBeDefined()
  // the notes keep "gün saat" together with a no-break space (NB) so a wrap never splits them:
  // the 5h one opens today (time alone), the weekly one two days on (weekday + time)
  expect(await ui.find({ text: /^Tükendi · açılış \d\d:\d\d \(2\u00a0sa\)$/ })).toBeDefined()
  expect(await ui.find({ text: /^Tükendi · açılış \S+\u00a0\d\d:\d\d \(2\u00a0g\)$/ })).toBeDefined()
  await ui.unmount()
})

test('99.6% is not shown as full', async ($, on) => {
  world(on, [
    { kind: 'five_hour', percentUsed: 99.6, resetsAt: iso(10 * MIN) },
    { kind: 'seven_day', percentUsed: 46, resetsAt: iso(3 * 24 * HOUR) },
  ])
  await $.session.measure(MEASURE)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /^%1 kalan$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^%0 kalan$/ })).toBeUndefined()
  await ui.press({ key: 'collapse' })
  expect(await ui.find({ type: 'Text', text: /^%99$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^%100$/ })).toBeUndefined()
  await ui.unmount()
})

test('an early run-out toasts once, on enough data', async ($, on) => {
  const w = world(on, [
    { kind: 'five_hour', percentUsed: 10, resetsAt: iso(4 * HOUR) },
    // four days into the week and at 80%: runs out well before the reset
    { kind: 'seven_day', percentUsed: 80, resetsAt: iso(3 * 24 * HOUR) },
  ])
  const clock = w.clock
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(10 * SEC)
  const early = w.toasts.filter(t => t.startsWith('Erken bitiş uyarısı: bu hızla haftalık limit '))
  expect(early).toHaveLength(1)
  expect(w.toasts.some(t => t.startsWith('Erken bitiş uyarısı: bu hızla 5 saatlik'))).toBe(false)
})

test('auto compact that leaves the context past the % holds instead of looping', async ($, on) => {
  const w = world(on, ON_TRACK)
  // a typed /compact is refused: the session's own compaction runs
  on('command.run', () => ({ deny: 'meşgul' }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // at 15%, below the context's 16%: the band asks first, and "Şimdi" starts it
  for (let i = 0; i < 13; i++) await ui.press({ key: 'autoDown' })
  expect(await ui.find({ type: 'Text', text: 'Bağlam zaten %16, eşik olan %15 aşıldı. Otomatik sıkıştırma:' })).toBeDefined()
  await ui.press({ key: 'askNow' })
  await ui.unmount()
  await w.clock.advance(30 * SEC)
  expect(w.toasts.filter(t => /^Sıkıştırmadan sonra bağlam hâlâ %16/.test(t))).toHaveLength(1)
  // the kit's compaction always completes; the six-try hold after a refusal is the same `stuck`
  await w.clock.advance(3 * MIN)
  expect(w.toasts.filter(t => /otomatik sıkıştırılıyor|hâlâ/.test(t))).toHaveLength(1)
})

test("Cetvel's reading with one window never blanks the other", async ($, on) => {
  const cetvel = service(200)
  const w = world(on, [], {
    entries: { limits: { at: NOW - 10 * MIN, limits: ON_TRACK } },
    files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) },
    cetvel: cetvel.answer,
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  // the 5 hour figure is Cetvel's (newer); the weekly one still the stored one, not 0
  expect(await ui.find({ type: 'Text', text: /^%92 kalan$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^%54 kalan$/ })).toBeDefined()
  await ui.unmount()
})

// the threshold set to 15, under the context's 16%: the band asks, and "Şimdi" answers
async function compactNowFromAsk($: Engine): Promise<void> {
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  for (let i = 0; i < 13; i++) await ui.press({ key: 'autoDown' })
  await ui.press({ key: 'askNow' })
  await ui.unmount()
}

const turnEnd = (turnId: string, agentId?: string) =>
  ({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer', ...(agentId ? { agentId } : {}) }) as never

test('a subagent ending never lets auto compact run inside the main turn', async ($, on) => {
  const w = world(on, ON_TRACK)
  on('command.run', () => ({ deny: 'meşgul' }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(5 * SEC)
  await $.turn.start({ text: 'iş', turnId: 'ana' })
  // asked mid-reply: put off, not tried against the running turn
  await compactNowFromAsk($)
  await $.turn.start({ text: 'alt iş', turnId: 'alt', agentId: 'ajan-1' })
  await w.clock.advance(4 * SEC)
  await $.turn.complete(turnEnd('alt', 'ajan-1'))
  await w.clock.advance(20 * SEC)
  expect(w.toasts.filter(t => /otomatik sıkıştırılıyor|hâlâ|denemede/.test(t))).toHaveLength(0)
  // the main turn's end: now it runs, once
  await $.turn.complete(turnEnd('ana'))
  await w.clock.advance(10 * SEC)
  expect(w.toasts.filter(t => /otomatik sıkıştırılıyor/.test(t))).toHaveLength(1)
  expect(w.toasts.filter(t => /^Sıkıştırmadan sonra bağlam hâlâ %16/.test(t))).toHaveLength(1)
})

test('one refusal of the direct compaction does not settle on typing /compact', async ($, on) => {
  let direct = 0
  const w = world(on, ON_TRACK)
  on('command.run', () => { throw new Error('tur bitiyor') })
  on('session.compact', () => {
    direct += 1
    if (direct === 1) throw new Error('yanıt sürüyor')
    return { messages: [{ role: 'user', text: 'özet', toolUses: [] }] } as never
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await compactNowFromAsk($)
  await w.clock.advance(30 * SEC)
  // direct (refused), typed (refused), direct again: started
  expect(direct).toBe(2)
  expect(w.toasts.some(t => /denemede başlatılamadı/.test(t))).toBe(false)
  expect(w.toasts.filter(t => /^Sıkıştırmadan sonra bağlam hâlâ %16/.test(t))).toHaveLength(1)
})

test('a reading that fails after a compaction never starts a second one', async ($, on) => {
  let compactions = 0
  let isFailing = false
  const w = world(on, ON_TRACK, {
    failUsage: () => {
      if (!isFailing) return false
      isFailing = false
      return true
    },
  })
  on('command.run', () => {
    compactions += 1
    return { text: '' } as never
  })
  on('session.compact', () => {
    compactions += 1
    isFailing = true
    return { messages: [{ role: 'user', text: 'özet', toolUses: [] }] } as never
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await compactNowFromAsk($)
  await w.clock.advance(30 * SEC)
  expect(compactions).toBe(1)
  expect(w.toasts.some(t => /denemede başlatılamadı/.test(t))).toBe(false)
})

test('chats probing the store together never take it for broken', async ($, on) => {
  const w = world(on, ON_TRACK, { probeClash: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(w.toasts.some(t => /ayar deposu bozuk/.test(t))).toBe(false)
  // the probe's own mark is cleared after it
  expect([...w.store.keys()].some(k => k.startsWith('__sonda'))).toBe(false)
})

test("a weekly reset on today's weekday reads as next week", async ($, on) => {
  world(on, [
    { kind: 'five_hour', percentUsed: 2, resetsAt: iso(4 * HOUR + 50 * MIN) },
    { kind: 'seven_day', percentUsed: 1, resetsAt: iso(7 * 24 * HOUR - 5 * MIN) },
  ])
  await $.session.measure(MEASURE)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: 'Kotan sıfırlanmaya kadar rahatça yeter' })).toBeDefined()
  // same weekday 7 days ahead shows date + time, never bare time as if today
  // (the note holds date and time together with no-break spaces)
  expect(await ui.find({ text: /sıfırlama 11\u00a0Eki\u00a0\d\d:\d\d/ })).toBeDefined()
  await ui.unmount()
})

test('with Cetvel: one slow answer does not grey the line', async ($, on) => {
  let isSlow = false
  const cetvel = service(200)
  const w = world(on, ON_TRACK, {
    files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) },
    cetvel: (path, method, body) => {
      if (isSlow) {
        isSlow = false
        return { status: 503 }
      }
      return cetvel.answer(path, method, body)
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)
  isSlow = true
  for (let i = 0; i < 30 && isSlow; i++) await w.clock.advance(SEC)
  expect(isSlow).toBe(false)
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: 'Codex' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '(Cetvel yanıt vermiyor)' })).toBeUndefined()
  await ui.unmount()
})

test('with Cetvel: a chat opening asks the lease before the usage service', async ($, on) => {
  const cetvel = service(409)
  const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) }, cetvel: cetvel.answer })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await w.clock.advance(6 * SEC)
  // another chat holds the lease: this one, just opened, did not ask
  expect(cetvel.seen.some(s => s.path === '/v1/claude/kira')).toBe(true)
  expect(w.asks).toBe(0)
})

test('a program that is not Cetvel on the port gets the token no more', async ($, on) => {
  const w = world(on, ON_TRACK, {
    files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) },
    cetvel: () => ({ status: 200, text: '<html>başka bir sunucu</html>' }),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)
  const sent = w.fetches.filter(f => f.auth).length
  expect(sent).toBeGreaterThan(0)
  await w.clock.advance(3 * MIN)
  expect(w.fetches.filter(f => f.auth).length).toBe(sent)
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /Diğer platformlar/ })).toBeUndefined()
  await ui.unmount()
})

test('other platforms: 99.6% is not full, and no plan name slips through', async ($, on) => {
  const snapshot = {
    ...SNAPSHOT,
    havuzlar: {
      codex_plus: { platform: 'codex', durum: 'ok', kaynak: { yas_sn: 40 }, pencereler: { '5s': { kullanilan: 0.996, kalan: 0.004 } } },
      chatgpt_pro: { platform: 'chatgpt_pro', durum: 'ok', kaynak: { yas_sn: 40 }, pencereler: { hafta: { kullanilan: 0.3, kalan: 0.7 } } },
      pro: { platform: 'pro', durum: 'ok', kaynak: { yas_sn: 40 }, pencereler: { hafta: { kullanilan: 0.5, kalan: 0.5 } } },
    },
  }
  const w = world(on, ON_TRACK, {
    files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) },
    cetvel: path => (path === '/v1/anlik' ? { status: 200, text: JSON.stringify(snapshot) } : { status: 200, text: '{}' }),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // 99.6% used leaves 1% (shown as the band writes Claude's: never full until it is)
  expect(await ui.find({ type: 'Text', text: '%1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'tükendi' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '%70' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Chatgpt' })).toBeDefined()
  expect(await ui.find({ text: /_|\bpro\b|Pro\b|Plus/ })).toBeUndefined()
  await ui.unmount()
})

test('/kota takes no inherited word for a mode', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const word of ['constructor', '__proto__']) {
    expect((await $.command.run({ command: 'kota', args: word } as never))?.text).toMatch(/^Kullanım: \/kota/)
  }
})

test('the Compact button says so in Turkish when /compact is refused', async ($, on) => {
  const w = world(on, ON_TRACK)
  on('command.run', () => { throw new Error('engine: busy') })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'compact' })
  await w.clock.advance(SEC)
  await ui.unmount()
  expect(w.toasts.filter(t => /^Sıkıştırma başlatılamadı/.test(t))).toHaveLength(1)
  expect(w.toasts.some(t => /busy/.test(t))).toBe(false)
})

test('short mode keeps two rows past 72 and opens one row at 86+ on both surfaces', async ($, on) => {
  const LONG_TR: SessionRateLimit[] = [
    { kind: 'five_hour', percentUsed: 70, resetsAt: iso(4 * HOUR + 59 * MIN) },
    { kind: 'seven_day', percentUsed: 46, resetsAt: iso(6 * 24 * HOUR + 23 * HOUR) },
  ]
  world(on, LONG_TR)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const first = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 72 } })
  await first.press({ key: 'collapse' })
  await first.unmount()

  for (const cols of [72, 78, 85]) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: cols } })
    expect(await ui.find({ key: 'shortTwoRow' })).toBeDefined()
    expect(await ui.find({ key: 'shortOneRow' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '4sa 59dk' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '6g 23sa' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '%70' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '%16' })).toBeDefined()
    await ui.unmount()
  }

  const termOne = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 86 } })
  expect(await termOne.find({ key: 'shortOneRow' })).toBeDefined()
  expect(await termOne.find({ type: 'Text', text: '4sa 59dk' })).toBeDefined()
  expect(await termOne.find({ type: 'Text', text: '6g 23sa' })).toBeDefined()
  await termOne.unmount()

  const termStack = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 54 } })
  expect(await termStack.find({ key: 'shortStack' })).toBeDefined()
  await termStack.unmount()

  const termTwo = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 55 } })
  expect(await termTwo.find({ key: 'shortTwoRow' })).toBeDefined()
  await termTwo.unmount()

  const deskTwo = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 85 } })
  expect(await deskTwo.find({ key: 'shortTwoRow' })).toBeDefined()
  await deskTwo.unmount()

  const deskOne = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 86 } })
  expect(await deskOne.find({ key: 'shortOneRow' })).toBeDefined()
  await deskOne.unmount()
})

test('detailed layout splits from 84 inner columns and compacts below it', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const termNarrow = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 83 } })
  expect(await termNarrow.find({ key: 'detailStack' })).toBeDefined()
  await termNarrow.unmount()

  const termSplit = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 84 } })
  expect(await termSplit.find({ key: 'detailSplit' })).toBeDefined()
  await termSplit.unmount()

  const deskCompact = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 83 } })
  expect(await deskCompact.find({ key: 'detailStack' })).toBeDefined()
  await deskCompact.unmount()

  const deskSplit = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 84 } })
  expect(await deskSplit.find({ key: 'detailSplit' })).toBeDefined()
  await deskSplit.unmount()
})

test('mobile surface draws Svg bars and soft-rounded hidden button cleanly across widths', async ($, on) => {
  world(on, RUNS_OUT)
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })

  for (const bodyColumns of [20, 34, 60, 100]) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'mobile', component: 'AbovePrompt', props: { ...PROPS, bodyColumns } })
    expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(0)
    expect(await ui.find({ type: 'Text', text: /^%30( kalan)?$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '%75' })).toBeDefined()
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ type: 'Text', text: '%16' })).toBeDefined()
    await ui.press({ key: 'hide' })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
    expect(await ui.drawn()).toBeDefined()
    await ui.press({ key: 'show' })
    await ui.press({ key: 'collapse' })
    await ui.unmount()
  }
})

test('near-full terminal bar with pace tick stays within its cell budget', async ($, on) => {
  world(on, [{ kind: 'five_hour', percentUsed: 1, resetsAt: iso(3 * HOUR) }])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // bodyColumns = 100 -> split on terminal: column = 48 -> claudeCells = 48 - 21 = 27
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: '━'.repeat(27) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '┃' })).toBeUndefined()
  await ui.unmount()
})

// --- the one pass raising old auto compact defaults (esik.ts) ---

const SHARED_DIR = `${CONFIG}/plugins/data/claude-auto-compact`
const sharedOf = (w: World, chat: string) => JSON.parse(w.files[`${SHARED_DIR}/${chat}.json`]!) as { isOn: boolean; at: number; t: number }

test('old defaults (40 and 80) move to 75 once; manual values (60, 70, 85, 90) are preserved', async ($, on) => {
  const w = world(on, ON_TRACK, {
    files: {
      // old defaults without a press timestamp (t 0): both 40 and 80 move to 75, on or off alike
      [`${SHARED_DIR}/sohbet-1.json`]: JSON.stringify({ isOn: true, at: 40, t: 0 }),
      [`${SHARED_DIR}/eski-80.json`]: JSON.stringify({ isOn: true, at: 80, t: 0 }),
      [`${SHARED_DIR}/kapali-1.json`]: JSON.stringify({ isOn: false, at: 40, t: 0 }),
      [`${SHARED_DIR}/kapali-80.json`]: JSON.stringify({ isOn: false, at: 80, t: 0 }),
      // t 0 at a % the band never opened a chat with: mirrored from a pressed store % -> stays by hand
      [`${SHARED_DIR}/yansima-1.json`]: JSON.stringify({ isOn: true, at: 65, t: 0 }),
      [`${SHARED_DIR}/yansima-2.json`]: JSON.stringify({ isOn: false, at: 60, t: 0 }),
      // kept in the store before `kaynak` was written: only a press wrote it, so it stays
      [`${SHARED_DIR}/eski-1.json`]: JSON.stringify({ isOn: true, at: 80, t: 0 }),
      [`${SHARED_DIR}/eski-2.json`]: JSON.stringify({ isOn: true, at: 70, t: 0 }),
      [`${SHARED_DIR}/eski-3.json`]: JSON.stringify({ isOn: true, at: 40, t: 0 }),
      // above default (85, 90) even with t 0: treated as set by hand and preserved
      [`${SHARED_DIR}/ust-1.json`]: JSON.stringify({ isOn: true, at: 85, t: 0 }),
      [`${SHARED_DIR}/ust-90.json`]: JSON.stringify({ isOn: true, at: 90, t: 0 }),
      // set by hand (here or in piksel-ofis): never touched, even at 40 or 80
      [`${SHARED_DIR}/elle-1.json`]: JSON.stringify({ isOn: true, at: 60, t: NOW - HOUR }),
      [`${SHARED_DIR}/elle-80.json`]: JSON.stringify({ isOn: true, at: 80, t: NOW - HOUR }),
      [`${SHARED_DIR}/piksel-ofis.alive`]: String(NOW),
    },
    entries: {
      'autoCompact:eski-1': { isOn: true, at: 80 },
      'autoCompact:eski-2': { isOn: true, at: 70 },
      'autoCompact:eski-3': { isOn: true, at: 40 },
      'autoCompact:elle-1': { isOn: true, at: 60 },
      // kept with who set it: default moves from 40 and 80 -> 75, manual 60 and 90 stay untouched
      'autoCompact:depo-40': { isOn: true, at: 40, kaynak: 'varsayılan' },
      'autoCompact:depo-80': { isOn: true, at: 80, kaynak: 'varsayılan' },
      'autoCompact:depo-60': { isOn: true, at: 60, kaynak: 'elle' },
      'autoCompact:depo-90': { isOn: true, at: 90, kaynak: 'elle' },
      // a store record alone, from before `kaynak`: a press, left alone
      'autoCompact:yalniz-1': { isOn: true, at: 50 },
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(sharedOf(w, 'sohbet-1')).toEqual({ isOn: true, at: 75, t: 0 })
  expect(sharedOf(w, 'eski-80')).toEqual({ isOn: true, at: 75, t: 0 })
  expect(sharedOf(w, 'kapali-1')).toEqual({ isOn: false, at: 75, t: 0 })
  expect(sharedOf(w, 'kapali-80')).toEqual({ isOn: false, at: 75, t: 0 })
  expect(sharedOf(w, 'yansima-1')).toEqual({ isOn: true, at: 65, t: 0 })
  expect(sharedOf(w, 'yansima-2')).toEqual({ isOn: false, at: 60, t: 0 })
  expect(sharedOf(w, 'eski-1')).toEqual({ isOn: true, at: 80, t: 0 })
  expect(sharedOf(w, 'eski-2')).toEqual({ isOn: true, at: 70, t: 0 })
  expect(sharedOf(w, 'eski-3')).toEqual({ isOn: true, at: 40, t: 0 })
  expect(sharedOf(w, 'ust-1')).toEqual({ isOn: true, at: 85, t: 0 })
  expect(sharedOf(w, 'ust-90')).toEqual({ isOn: true, at: 90, t: 0 })
  expect(sharedOf(w, 'elle-1')).toEqual({ isOn: true, at: 60, t: NOW - HOUR })
  expect(sharedOf(w, 'elle-80')).toEqual({ isOn: true, at: 80, t: NOW - HOUR })
  expect(w.files[`${SHARED_DIR}/piksel-ofis.alive`]).toBe(String(NOW))
  expect(w.store.get('autoCompact:eski-1')).toEqual({ isOn: true, at: 80 })
  expect(w.store.get('autoCompact:eski-2')).toEqual({ isOn: true, at: 70 })
  expect(w.store.get('autoCompact:eski-3')).toEqual({ isOn: true, at: 40 })
  expect(w.store.get('autoCompact:elle-1')).toEqual({ isOn: true, at: 60 })
  expect(w.store.get('autoCompact:depo-40')).toEqual({ isOn: true, at: 75, kaynak: 'varsayılan' })
  expect(w.store.get('autoCompact:depo-80')).toEqual({ isOn: true, at: 75, kaynak: 'varsayılan' })
  expect(w.store.get('autoCompact:depo-60')).toEqual({ isOn: true, at: 60, kaynak: 'elle' })
  expect(w.store.get('autoCompact:depo-90')).toEqual({ isOn: true, at: 90, kaynak: 'elle' })
  expect(w.store.get('autoCompact:yalniz-1')).toEqual({ isOn: true, at: 50 })
  expect(w.store.has('autoCompact:yansima-1')).toBe(false)
  expect(w.store.get('esikGecisi')).toBe(2)

  // this chat opens at the new %; a press then marks it as set by hand, in both places
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: '%75' })).toBeDefined()
  await ui.press({ key: 'autoUp' })
  expect(await ui.find({ type: 'Text', text: '%80' })).toBeDefined()
  await ui.unmount()
  expect(w.store.get('autoCompact:sohbet-1')).toEqual({ isOn: true, at: 80, kaynak: 'elle' })
  expect(sharedOf(w, 'sohbet-1').t).toBeGreaterThan(0)
})

test('upgrading from v80 (esikGecisi: 1) migrates unpressed 40 and 80 to 75 while preserving manual 60 and 90', async ($, on) => {
  const w = world(on, ON_TRACK, {
    files: {
      [`${SHARED_DIR}/eski-80.json`]: JSON.stringify({ isOn: true, at: 80, t: 0 }),
      [`${SHARED_DIR}/eski-40.json`]: JSON.stringify({ isOn: true, at: 40, t: 0 }),
      [`${SHARED_DIR}/elle-60.json`]: JSON.stringify({ isOn: true, at: 60, t: 0 }),
      [`${SHARED_DIR}/elle-90.json`]: JSON.stringify({ isOn: true, at: 90, t: 0 }),
    },
    entries: {
      esikGecisi: 1,
      'autoCompact:eski-80': { isOn: true, at: 80, kaynak: 'varsayılan' },
      'autoCompact:elle-60': { isOn: true, at: 60, kaynak: 'elle' },
      'autoCompact:elle-90': { isOn: true, at: 90, kaynak: 'elle' },
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sharedOf(w, 'eski-80')).toEqual({ isOn: true, at: 75, t: 0 })
  expect(sharedOf(w, 'eski-40')).toEqual({ isOn: true, at: 75, t: 0 })
  expect(sharedOf(w, 'elle-60')).toEqual({ isOn: true, at: 60, t: 0 })
  expect(sharedOf(w, 'elle-90')).toEqual({ isOn: true, at: 90, t: 0 })
  expect(w.store.get('autoCompact:eski-80')).toEqual({ isOn: true, at: 75, kaynak: 'varsayılan' })
  expect(w.store.get('autoCompact:elle-60')).toEqual({ isOn: true, at: 60, kaynak: 'elle' })
  expect(w.store.get('autoCompact:elle-90')).toEqual({ isOn: true, at: 90, kaynak: 'elle' })
  expect(w.store.get('esikGecisi')).toBe(2)
})

test('a chat whose % an older band kept (store without kaynak, shared t 0) opens at that % after the pass', async ($, on) => {
  const w = world(on, ON_TRACK, {
    files: { [`${SHARED_DIR}/sohbet-1.json`]: JSON.stringify({ isOn: true, at: 65, t: 0 }) },
    entries: { 'autoCompact:sohbet-1': { isOn: true, at: 65 } },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: '%65' })).toBeDefined()
  await ui.unmount()
  expect(w.store.get('autoCompact:sohbet-1')).toEqual({ isOn: true, at: 65 })
  expect(sharedOf(w, 'sohbet-1')).toEqual({ isOn: true, at: 65, t: 0 })
  expect(w.store.get('esikGecisi')).toBe(2)
})

test('the pass runs once: a default left at an old value after the current pass stays', async ($, on) => {
  const w = world(on, ON_TRACK, {
    files: { [`${SHARED_DIR}/sohbet-1.json`]: JSON.stringify({ isOn: true, at: 40, t: 0 }) },
    entries: { esikGecisi: 2 },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sharedOf(w, 'sohbet-1')).toEqual({ isOn: true, at: 40, t: 0 })
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: '%40' })).toBeDefined()
  await ui.unmount()
})

test('a new chat with nothing kept opens at 75, written as the default', async ($, on) => {
  const w = world(on, ON_TRACK)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sharedOf(w, 'sohbet-1')).toEqual({ isOn: true, at: 75, t: 0 })
  expect(w.store.get('esikGecisi')).toBe(2)
})

test('with the store broken, the pass reads and moves the fallback files (40 and 80 to 75)', async ($, on) => {
  const depo = `${CONFIG}/plugins/data/kota-bandi/depo`
  const w = world(on, ON_TRACK, {
    store: 'broken',
    files: {
      [`${SHARED_DIR}/eski-2.json`]: JSON.stringify({ isOn: true, at: 40, t: 0 }),
      [`${SHARED_DIR}/eski-80.json`]: JSON.stringify({ isOn: true, at: 80, t: 0 }),
      [`${depo}/autoCompact%3Avarsayilan-2.json`]: JSON.stringify({ v: { isOn: true, at: 40, kaynak: 'varsayılan' } }),
      [`${depo}/autoCompact%3Avarsayilan-80.json`]: JSON.stringify({ v: { isOn: true, at: 80, kaynak: 'varsayılan' } }),
      [`${depo}/autoCompact%3Aelle-2.json`]: JSON.stringify({ v: { isOn: true, at: 60, kaynak: 'elle' } }),
      // from before `kaynak`: a press, never moved
      [`${depo}/autoCompact%3Ayalniz-2.json`]: JSON.stringify({ v: { isOn: true, at: 40 } }),
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sharedOf(w, 'eski-2')).toEqual({ isOn: true, at: 75, t: 0 })
  expect(sharedOf(w, 'eski-80')).toEqual({ isOn: true, at: 75, t: 0 })
  expect(JSON.parse(w.files[`${depo}/autoCompact%3Avarsayilan-2.json`]!)).toEqual({ v: { isOn: true, at: 75, kaynak: 'varsayılan' } })
  expect(JSON.parse(w.files[`${depo}/autoCompact%3Avarsayilan-80.json`]!)).toEqual({ v: { isOn: true, at: 75, kaynak: 'varsayılan' } })
  expect(JSON.parse(w.files[`${depo}/autoCompact%3Aelle-2.json`]!)).toEqual({ v: { isOn: true, at: 60, kaynak: 'elle' } })
  expect(JSON.parse(w.files[`${depo}/autoCompact%3Ayalniz-2.json`]!)).toEqual({ v: { isOn: true, at: 40 } })
  expect(JSON.parse(w.files[`${depo}/esikGecisi.json`]!)).toEqual({ v: 2 })
})

// --- Cetvel's EWMA forecast preferred over the band's own pace ---

function withForecast(tahmin: Record<string, unknown>) {
  const snap = JSON.parse(JSON.stringify(SNAPSHOT)) as typeof SNAPSHOT
  ;(snap.havuzlar.claude_max as Record<string, unknown>).tahmin = tahmin
  return snap
}
function serviceWith(snap: unknown, isUp: () => boolean = () => true) {
  return (path: string) => {
    if (!isUp()) return { status: 503 }
    if (path === '/v1/anlik') return { status: 200, text: JSON.stringify(snap) }
    if (path === '/v1/claude/kira') return { status: 409, text: '{}' }
    if (path === '/v1/claude') return { status: 200, text: '{}' }
    return { status: 404 }
  }
}
// the reset is 3h 24m off at the first look, a minute less later on
const OWN_5H = new RegExp(`^Dönem sonu ~%\\d+ kalan${NB}\\(tahmini\\) · sıfırlama \\d\\d:\\d\\d \\(3${NB}sa${NB}2\\d${NB}dk\\)$`)
const EWMA_5H = new RegExp(`^Bitiş ~\\d\\d:\\d\\d · sıfırlama \\d\\d:\\d\\d \\(3${NB}sa${NB}24${NB}dk\\)$`)
const OWN_WEEK = new RegExp(`^Dönem sonu ~%19 kalan · sıfırlama .+ \\(3${NB}g${NB}7${NB}sa\\)$`)
const EWMA_BINDING = /^Bu hızla 5 saatlik limit sıfırlanmadan dolar$/

test("with Cetvel's EWMA forecast the band takes its pace, and its own again when Cetvel stops", async ($, on) => {
  let isUp = true
  // 30% of the window an hour: from 8%, full in 3h 4m, 20 minutes before the reset
  const snap = withForecast({ '5s': { durum: 'deneysel', etiket: 'deneysel', saatlik_hiz: 0.3, sifirlanmadan_biter: true } })
  const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) }, cetvel: serviceWith(snap, () => isUp) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // a third of the window seen: Cetvel's 'deneysel' forecast is firm enough (no "tahmini")
  expect(await ui.find({ text: EWMA_5H })).toBeDefined()
  expect(await ui.find({ text: EWMA_BINDING })).toBeDefined()
  // the weekly one has no Cetvel forecast: the band's own, as before
  expect(await ui.find({ text: OWN_WEEK })).toBeDefined()
  await ui.unmount()
  expect(w.toasts.filter(t => t.startsWith('Erken bitiş uyarısı: bu hızla 5 saatlik limit '))).toHaveLength(1)

  // the service stops answering: the band's own pace again, never a stale one
  isUp = false
  await w.clock.advance(40 * SEC)
  const later = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await later.find({ text: OWN_5H })).toBeDefined()
  expect(await later.find({ text: EWMA_5H })).toBeUndefined()
  await later.unmount()
})

test("Cetvel's end time alone gives the pace too", async ($, on) => {
  // no hourly pace, only when it runs out: from 8% at the snapshot, 3h 4m later
  const snap = withForecast({ '5s': { durum: 'hazir', bitis_tahmini: iso(3 * HOUR + 4 * MIN) } })
  const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) }, cetvel: serviceWith(snap) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: EWMA_BINDING })).toBeDefined()
  await ui.unmount()
})

for (const [name, tahmin] of [
  ['too few samples', { '5s': { durum: 'tahmin_yok', neden: "3'ten az ayrık örnek" } }],
  // a pace past the whole window an hour is a glitch, not a forecast
  ['a glitch', { '5s': { durum: 'deneysel', saatlik_hiz: 4 } }],
  // a weekly forecast while Cetvel holds no weekly window: nothing to match it to
  ['another window', { hafta: { durum: 'hazir', saatlik_hiz: 0.5 } }],
] as const) {
  test(`no usable Cetvel forecast (${name}): the band keeps its own`, async ($, on) => {
    const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) }, cetvel: serviceWith(withForecast(tahmin)) })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await w.clock.advance(6 * SEC)
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: OWN_5H })).toBeDefined()
    expect(await ui.find({ text: OWN_WEEK })).toBeDefined()
    await ui.unmount()
    expect(w.toasts.some(t => t.startsWith('Erken bitiş uyarısı'))).toBe(false)
  })
}

// --- the weekly window: an unchecked Cetvel forecast never stands for it ---

// Cetvel holding the weekly window too: 46% used, the reset 3d 7h off (half the week gone)
function withWeekly(tahmin: Record<string, unknown>) {
  const snap = withForecast(tahmin)
  const pool = snap.havuzlar.claude_max as { pencereler: Record<string, unknown> }
  pool.pencereler.hafta = { uzunluk_dk: 10080, kullanilan: 0.46, kalan: 0.54, sifirlama: iso(3 * 24 * HOUR + 7 * HOUR) }
  return snap
}
const EWMA_WEEK = new RegExp(`^Bitiş ~.+ · sıfırlama .+ \\(3${NB}g${NB}7${NB}sa\\)$`)
const WEEK_EARLY = 'Erken bitiş uyarısı: bu hızla haftalık limit '

for (const [name, tahmin] of [
  // a 30 minute busy spell in Cetvel's short EWMA: 1.74% an hour, %183 by the reset.
  // Cetvel keeps a 'deneysel' weekly forecast out of its own warnings: so does the band
  ['deneysel', { hafta: { durum: 'deneysel', etiket: 'deneysel', saatlik_hiz: 0.0174, sifirlanmadan_biter: true } }],
  // a weekly pace past 100% in 5 hours: a glitch, whoever says it
  ['too fast for a week', { hafta: { durum: 'hazir', saatlik_hiz: 0.3, sifirlanmadan_biter: true } }],
] as const) {
  test(`a weekly Cetvel forecast that is not to be trusted (${name}): the band's own damped pace, no early warning`, async ($, on) => {
    const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) }, cetvel: serviceWith(withWeekly(tahmin)) })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await w.clock.advance(6 * SEC)
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: OWN_WEEK })).toBeDefined()
    expect(await ui.find({ text: EWMA_WEEK })).toBeUndefined()
    await ui.unmount()
    expect(w.toasts.some(t => t.startsWith(WEEK_EARLY))).toBe(false)
  })
}

test("a checked ('hazir') weekly Cetvel forecast is taken, and warns", async ($, on) => {
  const snap = withWeekly({ hafta: { durum: 'hazir', etiket: 'hazir', saatlik_hiz: 0.0174, sifirlanmadan_biter: true } })
  const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) }, cetvel: serviceWith(snap) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: EWMA_WEEK })).toBeDefined()
  expect(await ui.find({ text: OWN_WEEK })).toBeUndefined()
  await ui.unmount()
  expect(w.toasts.filter(t => t.startsWith(WEEK_EARLY))).toHaveLength(1)
})

// --- "Diğer (kalan):" one line per pool, the share left, cut to fit ---

const pool = (platform: string, window: string, used: number, extra: Record<string, unknown> = {}) => ({
  platform, durum: 'ok', kaynak: { yas_sn: 40 }, pencereler: { [window]: { kullanilan: used, kalan: 1 - used } }, ...extra,
})
const AGY_SNAPSHOT = {
  sema: 2, yazan: 'cetvel', zaman: iso(0), sira: 1,
  havuzlar: {
    // the Claude/GPT pool is the most used: it must not stand in "Gemini"'s place
    agy_gemini: pool('agy', '5s', 0.77, { etiket: 'Antigravity Pro' }),
    agy_claude_gpt: pool('agy', '5s', 0.9, { etiket: 'Antigravity Ultra' }),
    agy_argon: pool('agy', 'hafta', 0.03, { etiket: 'Argon Max' }),
    codex_plus: pool('codex', 'hafta', 0.16, { etiket: 'Codex Plus' }),
    opencode: pool('opencode', '5s', 0.5),
  },
}

test('the three Antigravity pools stay three lines, the Claude/GPT figure never under "Gemini"', () => {
  cetvelReset()
  const { others } = readSnapshot(AGY_SNAPSHOT, NOW)!
  expect(others.map(o => [o.id, o.name, o.left])).toEqual([
    ['codex_plus', 'Codex', 84],
    ['agy_gemini', 'Antigravity · Gemini', 23],
    ['agy_claude_gpt', 'Antigravity · Claude/GPT', 10],
    ['agy_argon', 'Antigravity · Argon', 97],
    ['opencode', 'OpenCode', 50],
  ])
  // what is used stays the colour's measure, what is left is the figure
  expect(others.find(o => o.id === 'agy_gemini')).toMatchObject({ percent: 77, left: 23, level: 1 })
  expect(others.find(o => o.id === 'agy_claude_gpt')).toMatchObject({ percent: 90, left: 10, level: 2 })
  expect(others.filter(o => o.name === 'Antigravity · Gemini').length).toBe(1)
})

test('pool names: by id, never a plan; an unknown pool by a readable name', () => {
  cetvelReset()
  const snap = {
    sema: 2, yazan: 'cetvel', zaman: iso(0), sira: 1,
    havuzlar: {
      codex_pro: pool('codex', 'hafta', 0.1),
      agy_yeni_havuz: pool('agy', 'hafta', 0.2),
      chatgpt_plus: pool('chatgpt_plus', 'hafta', 0.3),
      constructor: pool('constructor', 'hafta', 0.4),
      plus: pool('plus', 'hafta', 0.5),
    },
  }
  const { others } = readSnapshot(snap, NOW)!
  expect(others.map(o => o.name).sort()).toEqual(['Agy Yeni Havuz', 'Chatgpt', 'Codex', 'Constructor'].sort())
  expect(others.some(o => /Plus|Pro|Max|Ultra|_/.test(o.name))).toBe(false)
})

test('a pool kept from before "left" existed still reads what is left', () => {
  const old = { id: 'x', name: 'Codex', percent: 72, window: 'hafta', isStale: false, level: 0 } as unknown as Other
  expect(leftShown(old)).toBe(28)
})

test('with Cetvel: Diğer platformlar lists every Antigravity pool in a table, on every surface', async ($, on) => {
  const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) }, cetvel: serviceWith(AGY_SNAPSHOT) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 130 } })
    expect(await ui.find({ type: 'Text', text: 'Diğer platformlar' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '5 saat kalan' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Haftalık kalan' })).toBeDefined()
    for (const name of ['Codex', 'Antigravity · Gemini', 'Antigravity · Claude/GPT', 'Antigravity · Argon', 'OpenCode']) {
      expect(await ui.find({ type: 'Text', text: name })).toBeDefined()
    }
    for (const left of [84, 23, 10, 97, 50]) expect(await ui.find({ type: 'Text', text: `%${left}` })).toBeDefined()
    expect(await ui.find({ text: /Plus|Pro\b|Max|Ultra/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('with Cetvel: a narrow band switches the table to 2-row cards without dropping pools', async ($, on) => {
  const w = world(on, ON_TRACK, { files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) }, cetvel: serviceWith(AGY_SNAPSHOT) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await w.clock.advance(6 * SEC)
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 60 } })
  // table headers disappear in card mode; all 5 pools remain visible in 2-row cards
  expect(await ui.find({ type: 'Text', text: 'Platform' })).toBeUndefined()
  for (const name of ['Codex', 'Antigravity · Gemini', 'Antigravity · Claude/GPT', 'Antigravity · Argon', 'OpenCode']) {
    expect(await ui.find({ type: 'Text', text: name })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /Modeller: Hydrogen, 3\.8 Flash/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Modeller: Opus, Sonnet, GPT-OSS/ })).toBeDefined()
  expect(await ui.find({ text: /Plus|Pro\b|Max|Ultra/ })).toBeUndefined()
  await ui.unmount()
})

test('fitOthers: whole when it fits, else the narrowest first and "+N", never past the width', () => {
  const mk = (id: string, name: string, left: number, window: string): Other => ({ id, name, percent: 100 - left, left, window, windows: [], isStale: false, level: 0 })
  const list = [mk('c', 'Codex', 84, 'hafta'), mk('g', 'Gemini', 23, '5 sa'), mk('p', 'Claude/GPT (agy)', 47, '5 sa'), mk('a', 'Argon', 97, 'hafta')]
  const all = fitOthers(list, 120, 1)
  expect(all.hidden).toBe(0)
  expect(all.shown.length).toBe(4)
  const mid = fitOthers(list, 60, 1)
  expect(mid.hidden).toBe(2)
  expect(mid.shown.map(o => o.id)).toEqual(['c', 'g'])
  // the narrowest are kept, in their own order, whatever the order they came in
  const tight = fitOthers(list, 50, 1)
  expect(tight.shown.every(o => o.id !== 'p')).toBe(true)
  // at the smallest width of all only "+N" is left, and it still fits
  expect(fitOthers(list, 20, 1)).toMatchObject({ shown: [], hidden: 4 })
  expect(OTHER_LEAD.length + 1 + '+4'.length).toBeLessThanOrEqual(20)
  // the row's own width model never passes the room it was given, from 20 to 120 columns
  const widthOf = (r: ReturnType<typeof fitOthers>, glyph: number) => {
    let chars = OTHER_LEAD.length
    let items = 1
    r.shown.forEach((o, i) => {
      chars += `${o.name} %${leftShown(o)} ${o.window}`.length + (i < r.shown.length - 1 || r.hidden > 0 ? 2 : 0)
      items += 1
    })
    if (r.hidden > 0) {
      chars += `+${r.hidden}`.length
      items += 1
    }
    return Math.ceil(chars * glyph) + items - 1
  }
  for (let cols = 20; cols <= 120; cols++) for (const glyph of [1, 0.8]) expect(widthOf(fitOthers(list, cols, glyph), glyph)).toBeLessThanOrEqual(cols)
  expect(otherFull(list, false)).toBe('Diğer (kalan): Codex %84 hafta · Gemini %23 5 sa · Claude/GPT (agy) %47 5 sa · Argon %97 hafta')
})

test('fitOthers: the stale note goes to the hint before a platform does', () => {
  const mk = (id: string, name: string, left: number): Other => ({ id, name, percent: 100 - left, left, window: 'hafta', windows: [], isStale: true, level: 0 })
  const list = [mk('c', 'Codex', 84), mk('g', 'Gemini', 23)]
  expect(fitOthers(list, 90, 1, true)).toMatchObject({ hidden: 0, hasNote: true })
  const r = fitOthers(list, 40, 1, true)
  expect(r.hasNote).toBe(false)
  expect(r.shown.length).toBeGreaterThan(0)
  expect(otherFull(list, true)).toContain('(Cetvel yanıt vermiyor)')
})

// --- New detailed view scenarios (ornek-anlik shape, no badge background, responsive table/cards) ---

test('live Cetvel snapshot: 3 agy pools, Argon dash in 5h, custom window labels, exhausted cells, no disconnected pool', async ($, on) => {
  const liveSnap = {
    sema: 2,
    yazan: 'cetvel',
    zaman: iso(0),
    sira: 454,
    havuzlar: {
      agy_argon: {
        platform: 'agy', etiket: 'Antigravity Argon', durum: 'ok', kaynak: { yas_sn: 1619 },
        pencereler: { hafta: { kullanilan: 0.0271, kalan: 0.9729, sifirlama: iso(5 * 24 * HOUR) } },
      },
      agy_claude_gpt: {
        platform: 'agy', etiket: 'Antigravity Claude-GPT', durum: 'ok', kaynak: { yas_sn: 1619 },
        pencereler: {
          '5s': { kullanilan: 0.9847, kalan: 0.0153 },
          hafta: { kullanilan: 1.0, kalan: 0.0, sifirlama: iso(5 * 24 * HOUR + HOUR) },
        },
      },
      agy_gemini: {
        platform: 'agy', etiket: 'Antigravity Gemini', durum: 'ok', kaynak: { yas_sn: 1619 },
        pencereler: {
          '5s': { kullanilan: 0.3149, kalan: 0.6851, sifirlama: iso(2 * HOUR) },
          hafta: { kullanilan: 0.8588, kalan: 0.1412, sifirlama: iso(4 * 24 * HOUR) },
        },
      },
      codex_plus: {
        platform: 'codex', etiket: 'Codex', durum: 'ok', kaynak: { yas_sn: 92 },
        pencereler: {
          '5s': { kullanilan: 1.0, kalan: 0.0, sifirlama: iso(2 * HOUR + 9 * MIN) },
          hafta: { kullanilan: 0.32, kalan: 0.68, sifirlama: iso(6 * 24 * HOUR) },
        },
      },
      opencode: {
        platform: 'opencode', etiket: 'OpenCode', durum: 'ok', kaynak: { yas_sn: 0 },
        pencereler: {
          '5dk': { kullanilan: 0.0, kalan: 1.0 },
          gun: { kullanilan: 0.0, kalan: 1.0 },
        },
      },
      deepseek: { platform: 'deepseek', etiket: 'DeepSeek', durum: 'baglanmadi', kullanilabilir: false },
    },
  }
  const w = world(on, [
    { kind: 'five_hour', percentUsed: 86, resetsAt: iso(50 * MIN) },
    { kind: 'seven_day', percentUsed: 79, resetsAt: iso(5 * 24 * HOUR) },
  ], {
    files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) },
    cetvel: serviceWith(liveSnap),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 100 } })
    // Claude rows show remaining %
    expect(await ui.find({ type: 'Text', text: '%14 kalan' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '%21 kalan' })).toBeDefined()
    // Table headers and all 5 connected pools
    expect(await ui.find({ type: 'Text', text: 'Platform' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '5 saat kalan' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Haftalık kalan' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Sıfırlama' })).toBeDefined()
    for (const name of ['Codex', 'Antigravity · Gemini', 'Antigravity · Claude/GPT', 'Antigravity · Argon', 'OpenCode']) {
      expect(await ui.find({ type: 'Text', text: name })).toBeDefined()
    }
    // Disconnected DeepSeek is hidden
    expect(await ui.find({ text: /DeepSeek/ })).toBeUndefined()
    // Remaining percentages (never used values 31, 86, 98, 32, 3)
    for (const pct of ['%69', '%14', '%2', '%97', '%68', '%100']) {
      expect(await ui.find({ type: 'Text', text: pct })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /^%(31|86|98|32|3)$/ })).toBeUndefined()
    // Argon has "—" in the 5h column
    expect(await ui.find({ type: 'Text', text: '—' })).toBeDefined()
    // custom window labels in cells (a pool with 5 dk and daily windows)
    expect(await ui.find({ type: 'Text', text: '5 dk' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'günlük' })).toBeDefined()
    // Exhausted cells read red "tükendi" and hints carry unlock time + models
    // (only the cells: a text match is by substring, and the hover hints say "tükendi" too)
    const exhausted = await ui.findAll({ type: 'Text', text: /^tükendi$/ })
    expect(exhausted.length).toBe(2)
    expect(exhausted.every(el => el.props.color === 'error')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /5 sa tükendi · açılış/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Modeller: Hydrogen, 3\.8 Flash/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Modeller: Opus, Sonnet, GPT-OSS · hafta tükendi · açılış/ })).toBeDefined()
    await ui.unmount()
  }
})

test('no highlighter badge or outer frame backgroundColor in any mode', async ($, on) => {
  const highUsage: SessionRateLimit[] = [
    { kind: 'five_hour', percentUsed: 92, resetsAt: iso(40 * MIN) },
    { kind: 'seven_day', percentUsed: 80, resetsAt: iso(4 * 24 * HOUR) },
  ]
  const w = world(on, highUsage, {
    files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) },
    cetvel: serviceWith(AGY_SNAPSHOT),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)

  for (const surface of [...SURFACES, 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: PROPS })
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.every(t => t.props.backgroundColor === undefined)).toBe(true)
    const boxes = await ui.findAll({ type: 'Box' })
    // single frame: neither the root container nor any badge carries backgroundColor or visible border
    expect(boxes.some(b => b.props.backgroundColor !== undefined)).toBe(false)
    expect(boxes.some(b => b.props.borderColor !== undefined && b.props.borderColor !== '#00000000')).toBe(false)
    expect(boxes[0]!.props.borderStyle).toBeUndefined()
    expect(boxes[0]!.props.paddingX).toBeUndefined()

    // short mode keeps the exact same single frame
    await ui.press({ key: 'collapse' })
    const shortTexts = await ui.findAll({ type: 'Text' })
    expect(shortTexts.every(t => t.props.backgroundColor === undefined)).toBe(true)
    const shortBoxes = await ui.findAll({ type: 'Box' })
    expect(shortBoxes.some(b => b.props.backgroundColor !== undefined)).toBe(false)
    expect(shortBoxes.some(b => b.props.borderColor !== undefined && b.props.borderColor !== '#00000000')).toBe(false)
    expect(shortBoxes[0]!.props.borderStyle).toBeUndefined()

    // hidden mode keeps the exact same single frame
    await ui.press({ key: 'hide' })
    const hiddenBoxes = await ui.findAll({ type: 'Box' })
    expect(hiddenBoxes.some(b => b.props.backgroundColor !== undefined)).toBe(false)
    expect(hiddenBoxes.some(b => b.props.borderColor !== undefined && b.props.borderColor !== '#00000000')).toBe(false)
    expect(hiddenBoxes[0]!.props.borderStyle).toBeUndefined()

    await ui.press({ key: 'show' })
    await ui.press({ key: 'collapse' })
    await ui.unmount()
  }
})

test('responsive thresholds: 4-col table, 3-col table, 2-row cards, and ultra-narrow without overflow', async ($, on) => {
  const w = world(on, RUNS_OUT, {
    files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) },
    cetvel: serviceWith(AGY_SNAPSHOT),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)

  for (const surface of SURFACES) {
    // 100 cols -> 2-col Claude+Context + 4-col table
    const wide = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 100 } })
    expect(await wide.find({ key: 'detailSplit' })).toBeDefined()
    expect(await wide.find({ type: 'Text', text: 'Sıfırlama' })).toBeDefined()
    const rightAligned = (await wide.findAll({ type: 'Box' })).filter(b => b.props.justifyContent === 'flex-end')
    expect(rightAligned.length).toBeGreaterThan(0)
    expect(rightAligned.every(b => b.props.flexDirection === 'row')).toBe(true)
    await wide.unmount()

    // 82 cols (single frame: innerWidth 82 on both surfaces) -> 1-col stack + 4-col table
    const midWide = await $.ui.mount({
      plugin: 'kota-bandi',
      surface,
      component: 'AbovePrompt',
      props: { ...PROPS, bodyColumns: 82 },
    })
    expect(await midWide.find({ key: 'detailStack' })).toBeDefined()
    expect(await midWide.find({ type: 'Text', text: 'Sıfırlama' })).toBeDefined()
    await midWide.unmount()

    // 74 cols -> 1-col + 3-col table (no Sıfırlama column)
    const mid = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 74 } })
    expect(await mid.find({ key: 'detailStack' })).toBeDefined()
    expect(await mid.find({ type: 'Text', text: '5 saat kalan' })).toBeDefined()
    expect(await mid.find({ type: 'Text', text: 'Sıfırlama' })).toBeUndefined()
    await mid.unmount()

    // 52 cols -> 2-row mini-bar cards
    const card = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 52 } })
    expect(await card.find({ type: 'Text', text: 'Platform' })).toBeUndefined()
    expect(await card.find({ type: 'Text', text: 'Antigravity · Gemini' })).toBeDefined()
    expect(await card.find({ type: 'Text', text: '%23' })).toBeDefined()
    await card.unmount()

    // 20 cols -> ultra-narrow text cards, no crash/overflow, values preserved
    const tiny = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 20, maxRows: 60 } })
    expect(await tiny.find({ type: 'Text', text: '%30' })).toBeDefined()
    expect(await tiny.find({ type: 'Text', text: 'Antigravity · Gemini' })).toBeDefined()
    expect(await tiny.find({ type: 'Text', text: '%23' })).toBeDefined()
    await tiny.unmount()
  }
})

// --- Bug-hunt regressions ---

test('headline and shortHeadline report the binding high-usage window instead of falsely praising the weekly window', () => {
  // 5-hour window at 85% (ok: resets soon before hitting 100%), weekly comfortably at 20%
  const fiveAmber = forecast({ kind: 'five_hour', percentUsed: 85, resetsAt: iso(15 * MIN) }, NOW)!
  const sevenLow = forecast({ kind: 'seven_day', percentUsed: 20, resetsAt: iso(5 * 24 * HOUR) }, NOW)!
  expect(fiveAmber.status).toBe('ok')
  expect(fiveAmber.level).toBe(1)
  const h1 = headline([fiveAmber, sevenLow], NOW)!
  const s1 = shortHeadline([fiveAmber, sevenLow], NOW)!
  expect(h1.level).toBe(1)
  expect(h1.text).toContain('5 Saat')
  expect(s1.level).toBe(1)
  expect(s1.text).toContain('5 Saat')
  expect(s1.text).not.toContain('rahatça yeter')

  // 5-hour window at 92% (ok, red level 2) -> red warning
  const fiveRed = forecast({ kind: 'five_hour', percentUsed: 92, resetsAt: iso(5 * MIN) }, NOW)!
  expect(fiveRed.status).toBe('ok')
  expect(fiveRed.level).toBe(2)
  expect(headline([fiveRed, sevenLow], NOW)!.level).toBe(2)
  expect(shortHeadline([fiveRed, sevenLow], NOW)).toEqual({ text: '5 Saat dolmak üzere · %8 kaldı', level: 2 })
})

test('expired Cetvel window resets stale exhausted status to %100 left and drops past reset times', async ($, on) => {
  cetvelReset()
  const expiredSnap = {
    sema: 2, yazan: 'cetvel', zaman: iso(0), sira: 1,
    havuzlar: {
      codex_plus: {
        platform: 'codex', etiket: 'Codex', durum: 'ok', kaynak: { yas_sn: 10 },
        pencereler: { '5s': { kullanilan: 1.0, kalan: 0.0, sifirlama: iso(5 * MIN) } },
      },
    },
  }
  const w = world(on, ON_TRACK, {
    files: { [LINK]: JSON.stringify({ port: 43117, jeton: TOKEN }) },
    // after initial fetch, answer 304 so cached view passes its 5m reset
    cetvel: (() => {
      let sent = false
      return (path: string) => {
        if (path.startsWith('/v1/anlik')) {
          if (!sent) {
            sent = true
            return { status: 200, text: JSON.stringify(expiredSnap), headers: { etag: '"1"' } }
          }
          return { status: 304, text: '' }
        }
        return { status: 200, text: '{}' }
      }
    })(),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(6 * SEC)
  const metin = async () => {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const s = (await ui.findAll({ type: 'Text' })).map(x => x.text).join(' ')
    await ui.unmount()
    return s
  }
  expect(await metin()).toContain('tükendi')

  // 5 dakikalık sıfırlama geçince, yalnız 304 gelse bile hücre "tükendi" kalmaz
  await w.clock.advance(6 * MIN)
  const sonra = await metin()
  expect(sonra).toContain('Codex')
  expect(sonra).not.toContain('tükendi')
})

test('NaN, Infinity, past timestamps, missing Cetvel fields, and zero context window do not crash or render NaN', async ($, on) => {
  expect(duration(NaN)).toBe('—')
  expect(duration(Infinity)).toBe('—')
  expect(shortClock(NaN, NOW)).toBe('—')
  expect(dayTime(Infinity, NOW)).toBe('—')
  expect(shortClock(NOW - 30 * 24 * HOUR, NOW)).not.toContain('NaN')
  expect(dayTime(NOW - 30 * 24 * HOUR, NOW)).not.toContain('haftaya')

  const badForecast = forecast({ kind: 'five_hour', percentUsed: NaN, resetsAt: iso(2 * HOUR) }, NOW)!
  expect(Number.isFinite(badForecast.percent)).toBe(true)
  expect(markerOf({ ...badForecast, projected: NaN })).toBeUndefined()
  expect(leftMarkerOf({ ...badForecast, projected: Infinity })).toBeUndefined()

  const partialOther = { id: 'custom_pool', name: 'Özel', percent: NaN, window: '5 sa', isStale: false, level: 0 } as unknown as Other
  expect(leftShown(partialOther)).toBe(0)
  expect(() => poolSlots(partialOther)).not.toThrow()
  expect(() => poolResetWindow(partialOther, NOW)).not.toThrow()
  expect(poolModels(undefined)).toBeUndefined()
  expect(fitOthers([partialOther], 0, 1)).toEqual({ shown: [], hidden: 1, hasNote: false })

  const w = world(on, [{ kind: 'five_hour', percentUsed: NaN as never, resetsAt: iso(2 * HOUR) }])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
  expect(texts).not.toMatch(/NaN|Infinity/)
  await ui.unmount()
  expect(w.logs.every(l => !l.includes('NaN'))).toBe(true)
})

test('narrow 20-column width renders detailed ask prompt, short mode, and concise hidden button', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 20, maxRows: 60 } })
    for (let i = 0; i < 12; i++) await ui.press({ key: 'autoDown' })
    const askNext = await ui.find({ type: 'Button', key: 'askNext' })
    expect(askNext).toBeDefined()
    expect(String(askNext!.props.label).length).toBeLessThanOrEqual(20)
    await ui.press({ key: 'hide' })
    const show = await ui.find({ type: 'Button', key: 'show' })
    expect(show).toBeDefined()
    if (surface === 'terminal') expect(String(show!.props.label).length).toBeLessThanOrEqual(10)
    await ui.press({ key: 'show' })
    await ui.press({ key: 'askNext' })
    for (let i = 0; i < 12; i++) await ui.press({ key: 'autoUp' })
    await ui.unmount()
  }
})

test('restore skips malformed depo filenames and still recovers valid keys', async ($, on) => {
  let broken = true
  const depo = `${CONFIG}/plugins/data/kota-bandi/depo`
  const w = world(on, ON_TRACK, {
    isStoreBroken: () => broken,
    files: {
      [`${depo}/autoCompact%ZZ.json`]: JSON.stringify({ v: { isOn: true, at: 50 } }),
      [`${depo}/nul-bozuk.json`]: '\u0000\u0000\u0000',
      [`${depo}/view.json`]: JSON.stringify({ v: { mode: 'kisa', last: 'kisa', t: NOW + 100 } }),
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  broken = false
  // 5-minute store retry probe runs restore()
  await w.clock.advance(5 * 60_000 + SEC)
  expect(w.store.get('view')).toEqual({ mode: 'kisa', last: 'kisa', t: NOW + 100 })
})
