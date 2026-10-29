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

test('the band speaks English on every surface', async ($, on) => {
  world(on, ON_TRACK)
  await $.session.measure(MEASURE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: /^On track: your quota lasts until it resets \(.+\)\.$/ })).toBeDefined()
    expect(await ui.find({ text: '16% full' })).toBeDefined()
    expect(await ui.find({ text: '809k free of 1M' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Messages' })).toBeDefined()
    expect(await ui.find({ text: '5 hour' })).toBeDefined()
    expect(await ui.find({ text: 'Weekly' })).toBeDefined()
    expect(await ui.find({ text: '46%' })).toBeDefined()
    expect(await ui.find({ text: `About 81% at reset – resets${NB}in${NB}3d${NB}7h` })).toBeDefined()
    expect(await ui.find({ text: /kullanıldı|boş|Yolundasın|Haftalık|sıfırlanır|Bağlam/ })).toBeUndefined()
    await ui.unmount()
  }
})
