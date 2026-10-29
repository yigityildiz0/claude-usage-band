import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionRateLimit, SessionUsage } from 'claude-code'

const NOW = Date.parse('2026-10-04T06:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const SURFACES = ['terminal', 'desktop'] as const
const NB = '\u00a0'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
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

// what the engine answers beneath the plugin: no first-party login, its own empty band
function world(on: On, rateLimits: SessionRateLimit[]) {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usage(rateLimits) }))
  on('session.authorize', () => ({ value: null }))
  on('session.measure', () => ({ changed: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
}

const MEASURE = { context: { window: 1_000_000, tokens: 158_000, percent: 16 }, rateLimits: [] }
const ON_TRACK: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 8, resetsAt: iso(3 * HOUR + 24 * MIN) },
  { kind: 'seven_day', percentUsed: 46, resetsAt: iso(3 * 24 * HOUR + 7 * HOUR) },
]

test('the band speaks Turkish on every surface', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'kota-bandi', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: /^Yolundasın: kotan sıfırlanmaya \(.+ \d\d:\d\d\) kadar rahatça yeter\.$/ })).toBeDefined()
    expect(await ui.find({ text: '%16 dolu' })).toBeDefined()
    expect(await ui.find({ text: '1M içinde 809k boş' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Mesajlar' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Araçlar' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Diğer' })).toBeDefined()
    expect(await ui.find({ text: '5 Saat' })).toBeDefined()
    expect(await ui.find({ text: 'Haftalık' })).toBeDefined()
    expect(await ui.find({ text: '%46' })).toBeDefined()
    expect(await ui.find({ text: `Sıfırlanmada tahminen %81 – 3g${NB}7sa${NB}sonra${NB}sıfırlanır` })).toBeDefined()
    expect(await ui.find({ text: /used|free of|On track|Weekly|resets in/ })).toBeUndefined()
    if (surface === 'desktop') {
      const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
      expect(alts.some(a => /^5 Saat %8 kullanıldı/.test(a))).toBe(true)
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

test('the stepper stops at its ends', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.measure(MEASURE)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  for (let i = 0; i < 20; i++) await ui.press({ key: 'autoUp' })
  expect(await ui.find({ type: 'Text', text: '%95' })).toBeDefined()
  for (let i = 0; i < 30; i++) await ui.press({ key: 'autoDown' })
  expect(await ui.find({ type: 'Text', text: '%15' })).toBeDefined()
  await ui.unmount()
})

test('a pace that runs out warns in Turkish, collapsed too', async ($, on) => {
  world(on, [
    { kind: 'five_hour', percentUsed: 70, resetsAt: iso(4 * HOUR) },
    { kind: 'seven_day', percentUsed: 46, resetsAt: iso(3 * 24 * HOUR) },
  ])
  await $.session.measure(MEASURE)

  const ui = await $.ui.mount({ plugin: 'kota-bandi', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /^Bu hızla limit, sıfırlanmadan \(bugün \d\d:\d\d\) önce dolacak\.$/ })).toBeDefined()
  expect(await ui.find({ text: /^Limit .+ içinde dolar – / })).toBeDefined()
  await ui.press({ key: 'collapse' })
  expect(await ui.find({ type: 'Text', text: '5 Saat' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Hafta' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '%70' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()
  await ui.unmount()
})
