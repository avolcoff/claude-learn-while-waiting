import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const OK = { exitCode: 0, stdout: '1', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// The decoded text of a PowerShell -EncodedCommand call, else the argv joined.
const textOf = (argv: readonly string[]) => {
  const at = argv.indexOf('-EncodedCommand')
  if (at < 0) {
    return argv.join(' ')
  }
  const bytes = atob(argv[at + 1] ?? '')
  let out = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(bytes.charCodeAt(i) + (bytes.charCodeAt(i + 1) << 8))
  }

  return out
}

// The engine beneath the mod: every process call is recorded and answered "1".
const world = (on: On, os: string | undefined) => {
  const calls: string[] = []
  const stored: Record<string, unknown> = {}
  mock.env(on, os === undefined ? {} : { OS: os })
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'learn' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    calls.push(textOf(e.argv))

    return { value: OK }
  })
  on('http.fetch', () => ({
    value: { status: 200, ok: true, headers: {}, text: '{"videoId":"aircAruvnKk"}' } as never,
  }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  return { calls, clock, stored }
}

const startSession = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const startTurn = ($: any, id = 't1') => $.turn.start({ text: 'hello', turnId: id })
const endTurn = ($: any, id = 't1') =>
  $.turn.complete({ turnId: id, reason: 'answer', answer: '', durationMs: 1000 })

test('nothing runs off Windows', async ($, on) => {
  const { calls, clock } = world(on, undefined)
  await startSession($)
  await startTurn($)
  await clock.advance(60_000)
  await endTurn($)
  await clock.settle()

  expect(calls).toEqual([])
})

test('a short turn opens no video and moves no window', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await startTurn($)
  await clock.advance(3_000)
  await endTurn($)
  await clock.advance(60_000)

  expect(calls).toEqual([])
})

test('a long turn waits, opens the video, then pauses it and goes back', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await startTurn($)

  await clock.advance(7_000)
  expect(calls).toEqual([])

  await clock.advance(2_000)
  await clock.settle()
  expect(calls.some(c => c.includes('rundll32.exe') && c.includes('aircAruvnKk'))).toBe(true)
  expect(calls.some(c => c.includes('SetForegroundWindow'))).toBe(true)

  const before = calls.length
  await endTurn($)
  await clock.settle()
  const after = calls.slice(before).join('\n')
  expect(after).toContain('TryPauseAsync')
  expect(after).toContain('SetForegroundWindow')
})

test('/learn off stops it and the choice is kept', async ($, on) => {
  const { calls, clock, stored } = world(on, 'Windows_NT')
  await startSession($)
  const ran = await $.command.run({ command: 'learn', args: 'off', origin: 'composer', presentation: 'inline' } as never)
  expect(JSON.stringify(ran)).toContain('off')
  expect(stored['learn.enabled']).toBe(false)

  await startTurn($)
  await clock.advance(60_000)
  await endTurn($)
  expect(calls).toEqual([])
})

test('/learn wait sets the delay and refuses nonsense', async ($, on) => {
  const { calls, clock, stored } = world(on, 'Windows_NT')
  await startSession($)
  const bad = await $.command.run({ command: 'learn', args: 'wait banana', origin: 'composer', presentation: 'inline' } as never)
  expect(JSON.stringify(bad)).toContain('Usage')

  await $.command.run({ command: 'learn', args: 'wait 2', origin: 'composer', presentation: 'inline' } as never)
  expect(stored['learn.wait']).toBe(2)

  await startTurn($)
  await clock.advance(3_000)
  await clock.settle()
  expect(calls.some(c => c.includes('rundll32.exe'))).toBe(true)
})

test('a subagent turn does not start a video', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await $.turn.start({ text: 'work', turnId: 's1', agentId: 'sub-1' })
  await clock.advance(60_000)

  expect(calls).toEqual([])
})
