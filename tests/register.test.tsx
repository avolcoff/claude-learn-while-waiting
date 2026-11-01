import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type Ran = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }

const reply = (stdout = '1', exitCode = 0, stderr = ''): Ran => ({
  exitCode,
  stdout,
  stderr,
  isStdoutTruncated: false,
  isStderrTruncated: false,
})
const OK = reply()

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

// Which job a process call is, so a test can answer each one differently.
const kindOf = (text: string) => {
  if (text.includes('rundll32.exe')) return 'open'
  if (text.includes('Measure-Object')) return 'windows'
  const action = text.match(/'(Pause|Play|Count)' -eq '\1'/)?.[1]
  if (action) return action.toLowerCase()
  if (text.includes('GetForegroundWindow().ToInt64()')) return 'save'
  if (text.includes("'front' -eq")) return 'raise'

  return 'other'
}

type Options = {
  // Answers one process call; the default answers "1" to all.
  run?: (kind: string, text: string) => Ran
  // The text YouTube's search page answers with, or an error to throw.
  page?: string | Error
  stored?: Record<string, unknown>
}

// The engine beneath the mod: every process call is recorded and answered.
const world = (on: On, os: string | undefined, options: Options = {}) => {
  const calls: string[] = []
  const toasts: string[] = []
  const stored: Record<string, unknown> = options.stored ?? {}
  mock.env(on, os === undefined ? {} : { OS: os })
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'learn' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    const text = textOf(e.argv)
    calls.push(text)

    return { value: (options.run ?? (() => OK))(kindOf(text), text) }
  })
  on('http.fetch', () => {
    if (options.page instanceof Error) {
      throw options.page
    }

    return {
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: options.page ?? '{"videoId":"aircAruvnKk"}',
      } as never,
    }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  return { calls, clock, stored, toasts }
}

const startSession = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const startTurn = ($: any, id = 't1', text = 'hello') => $.turn.start({ text, turnId: id })
const endTurn = ($: any, id = 't1') =>
  $.turn.complete({ turnId: id, reason: 'answer', answer: '', durationMs: 1000 })
const learn = ($: any, args: string) =>
  $.command.run({ command: 'learn', args, origin: 'composer', presentation: 'inline' } as never)

// One whole long turn: start, wait past the delay, let the video open, finish.
const longTurn = async ($: any, clock: any, id = 't1') => {
  await startTurn($, id)
  await clock.advance(9_000)
  await clock.settle()
  await endTurn($, id)
  await clock.settle()
}

const opened = (calls: string[]) => calls.filter(c => kindOf(c) === 'open')

test('nothing runs off Windows', async ($, on) => {
  const { calls, clock } = world(on, undefined)
  await startSession($)
  await startTurn($)
  await clock.advance(60_000)
  await endTurn($)
  await clock.settle()

  expect(calls).toEqual([])
})

test('nothing runs on other systems that name an OS', async ($, on) => {
  const { calls, clock } = world(on, 'Darwin')
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

test('the video opens as a playable watch page', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await startTurn($)
  await clock.advance(9_000)
  await clock.settle()

  expect(opened(calls)[0]).toContain('https://www.youtube.com/watch?v=aircAruvnKk&autoplay=1')
})

test('a second long turn resumes the paused video instead of opening another', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await longTurn($, clock, 't1')
  expect(opened(calls)).toHaveLength(1)

  const before = calls.length
  await startTurn($, 't2')
  await clock.advance(9_000)
  await clock.settle()
  const second = calls.slice(before)

  expect(second.filter(c => kindOf(c) === 'play')).toHaveLength(1)
  expect(opened(second)).toHaveLength(0)
})

test('a closed video window is replaced by a new video', async ($, on) => {
  let isClosed = false
  const { calls, clock } = world(on, 'Windows_NT', {
    // Once closed, no browser session and no YouTube window are left.
    run: kind => (isClosed && (kind === 'count' || kind === 'windows') ? reply('0') : OK),
  })
  await startSession($)
  await longTurn($, clock, 't1')
  isClosed = true

  const before = calls.length
  await startTurn($, 't2')
  await clock.advance(9_000)
  await clock.settle()

  expect(opened(calls.slice(before))).toHaveLength(1)
})

test('a resume that fails opens a new video', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT', {
    run: kind => (kind === 'play' ? reply('0') : OK),
  })
  await startSession($)
  await longTurn($, clock, 't1')

  const before = calls.length
  await startTurn($, 't2')
  await clock.advance(9_000)
  await clock.settle()

  expect(opened(calls.slice(before))).toHaveLength(1)
})

test('an empty message starts no video', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await startTurn($, 't1', '')
  await clock.advance(60_000)

  expect(calls).toEqual([])
})

test('a turn that finishes before the wait cancels the video', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await startTurn($, 't1')
  await clock.advance(5_000)
  await endTurn($, 't1')
  await startTurn($, 't2')
  await clock.advance(5_000)
  // t1's timer is due now, but t1 is over; t2's is not due yet.
  await clock.settle()

  expect(opened(calls)).toHaveLength(0)
})

test('/learn off stops it and the choice is kept', async ($, on) => {
  const { calls, clock, stored } = world(on, 'Windows_NT')
  await startSession($)
  const ran = await learn($, 'off')
  expect(JSON.stringify(ran)).toContain('off')
  expect(stored['learn.enabled']).toBe(false)

  await startTurn($)
  await clock.advance(60_000)
  await endTurn($)
  expect(calls).toEqual([])
})

test('/learn off during the wait cancels the video that wait was for', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await startTurn($)
  await clock.advance(4_000)
  await learn($, 'off')
  await clock.advance(10_000)
  await clock.settle()

  expect(calls).toEqual([])
})

test('/learn on turns it back on', async ($, on) => {
  const { clock, calls, stored } = world(on, 'Windows_NT')
  await startSession($)
  await learn($, 'off')
  const ran = await learn($, 'on')
  expect(JSON.stringify(ran)).toContain('is on')
  expect(stored['learn.enabled']).toBe(true)

  await startTurn($)
  await clock.advance(9_000)
  await clock.settle()
  expect(opened(calls)).toHaveLength(1)
})

test('/learn alone reports the state and opens the pane', async ($, on) => {
  world(on, 'Windows_NT')
  await startSession($)
  const ran = JSON.stringify(await learn($, ''))

  expect(ran).toContain('is on')
  expect(ran).toContain('8s')
  expect(ran).not.toContain('only works on Windows')
})

test('/learn says it is Windows only elsewhere', async ($, on) => {
  world(on, undefined)
  await startSession($)

  expect(JSON.stringify(await learn($, ''))).toContain('only works on Windows')
})

test('/learn wait sets the delay and refuses nonsense', async ($, on) => {
  const { calls, clock, stored } = world(on, 'Windows_NT')
  await startSession($)
  const bad = await learn($, 'wait banana')
  expect(JSON.stringify(bad)).toContain('Usage')

  await learn($, 'wait 2')
  expect(stored['learn.wait']).toBe(2)

  await startTurn($)
  await clock.advance(3_000)
  await clock.settle()
  expect(calls.some(c => c.includes('rundll32.exe'))).toBe(true)
})

test('/learn wait takes 0 to 300 whole seconds and nothing else', async ($, on) => {
  const { stored } = world(on, 'Windows_NT')
  await startSession($)

  for (const ok of ['0', '300', '45']) {
    await learn($, `wait ${ok}`)
    expect(stored['learn.wait']).toBe(Number(ok))
  }
  for (const bad of ['301', '-1', '1.5', '15abc', '', ' ', '1e2']) {
    await learn($, 'wait 7')
    const ran = JSON.stringify(await learn($, `wait ${bad}`))
    expect(ran).toContain('Usage')
    expect(stored['learn.wait']).toBe(7)
  }
})

test('/learn wait 0 opens the video at once', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await learn($, 'wait 0')
  await startTurn($)
  await clock.advance(1)
  await clock.settle()

  expect(opened(calls)).toHaveLength(1)
})

test('the saved settings come back in the next session', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT', { stored: { 'learn.enabled': true, 'learn.wait': 3 } })
  await startSession($)
  expect(JSON.stringify(await learn($, ''))).toContain('3s')

  await startTurn($)
  await clock.advance(4_000)
  await clock.settle()
  expect(opened(calls)).toHaveLength(1)
})

test('a saved "off" stays off in the next session', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT', { stored: { 'learn.enabled': false } })
  await startSession($)
  await startTurn($)
  await clock.advance(60_000)

  expect(calls).toEqual([])
})

// The engine cannot be re-armed inside one test, so each bad value is its own.
const damagedWait = (bad: unknown, label: string) =>
  test(`a damaged saved wait (${label}) falls back to the default`, async ($, on) => {
    const { calls, clock } = world(on, 'Windows_NT', { stored: { 'learn.wait': bad } })
    await startSession($)
    expect(JSON.stringify(await learn($, ''))).toContain('8s')

    await startTurn($)
    await clock.advance(7_000)
    expect(calls).toEqual([])
    await clock.advance(2_000)
    await clock.settle()
    expect(opened(calls)).toHaveLength(1)
  })

damagedWait(999, 'too large')
damagedWait(-5, 'negative')
damagedWait(2.5, 'fractional')
damagedWait('soon', 'text')
damagedWait(null, 'null')

test('a subagent turn does not start a video', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await $.turn.start({ text: 'work', turnId: 's1', agentId: 'sub-1' })
  await clock.advance(60_000)

  expect(calls).toEqual([])
})

test('a subagent finishing does not pause the video or move a window', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT')
  await startSession($)
  await startTurn($)
  await clock.advance(9_000)
  await clock.settle()

  const before = calls.length
  await $.turn.complete({ turnId: 's1', agentId: 'sub-1', reason: 'answer', answer: '', durationMs: 10 })
  await clock.settle()

  expect(calls.length).toBe(before)
})

test('the search page opens when YouTube cannot be reached', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT', { page: new Error('offline') })
  await startSession($)
  await startTurn($)
  await clock.advance(9_000)
  await clock.settle()

  const url = opened(calls)[0] ?? ''
  expect(url).toContain('https://www.youtube.com/results?search_query=')
  expect(url).not.toContain('autoplay')
})

test('the search page opens when YouTube answers with no video', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT', { page: '<html>no ids here</html>' })
  await startSession($)
  await startTurn($)
  await clock.advance(9_000)
  await clock.settle()

  expect(opened(calls)[0]).toContain('/results?search_query=')
})

test('a malformed video id is not trusted', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT', { page: '{"videoId":"short&calc.exe"}' })
  await startSession($)
  await startTurn($)
  await clock.advance(9_000)
  await clock.settle()

  const url = opened(calls)[0] ?? ''
  expect(url).toContain('/results?search_query=')
  expect(url).not.toContain('calc.exe')
})

test('a browser that will not open tells the person and nothing else runs', async ($, on) => {
  const { calls, clock, toasts } = world(on, 'Windows_NT', {
    run: kind => {
      if (kind === 'open') throw new Error('no handler')

      return OK
    },
  })
  await startSession($)
  await startTurn($)
  await clock.advance(9_000)
  await clock.settle()
  expect(toasts.some(t => t.includes("Couldn't open the video"))).toBe(true)

  const before = calls.length
  await endTurn($)
  await clock.settle()
  expect(calls.slice(before).some(c => kindOf(c) === 'pause')).toBe(false)
})

test('a pause that fails is reported and the person still goes back', async ($, on) => {
  const { calls, clock, toasts } = world(on, 'Windows_NT', {
    run: kind => (kind === 'pause' ? reply('', 1, 'access denied') : OK),
  })
  await startSession($)
  await startTurn($)
  await clock.advance(9_000)
  await clock.settle()

  const before = calls.length
  await endTurn($)
  await clock.settle()

  expect(toasts.some(t => t.includes("Couldn't pause the video"))).toBe(true)
  expect(calls.slice(before).some(c => c.includes('SetForegroundWindow'))).toBe(true)
})

test('a video with nothing to pause says so', async ($, on) => {
  const { clock, toasts } = world(on, 'Windows_NT', {
    run: kind => (kind === 'pause' ? reply('0') : OK),
  })
  await startSession($)
  await longTurn($, clock)

  expect(toasts.some(t => t.includes('No browser video to pause'))).toBe(true)
})

test('the person is sent back to the window they were in', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT', {
    run: kind => (kind === 'save' ? reply('987654') : OK),
  })
  await startSession($)
  await longTurn($, clock)

  expect(calls.some(c => c.includes('[IntPtr][long]987654'))).toBe(true)
})

test('a window id that is not a number is never put in the script', async ($, on) => {
  const { calls, clock } = world(on, 'Windows_NT', {
    run: kind => (kind === 'save' ? reply('1; Remove-Item C:\\ -Recurse') : OK),
  })
  await startSession($)
  await longTurn($, clock)

  expect(calls.some(c => c.includes('Remove-Item'))).toBe(false)
  expect(calls.some(c => c.includes('[IntPtr][long]0'))).toBe(true)
})

test('the browser is not sent back to when it never came forward', async ($, on) => {
  // The video never starts (its window id read fails), so no turn.complete move.
  const { calls, clock } = world(on, 'Windows_NT', {
    run: kind => {
      if (kind === 'open') throw new Error('blocked')

      return OK
    },
  })
  await startSession($)
  await longTurn($, clock)

  expect(calls.some(c => kindOf(c) === 'raise')).toBe(false)
})

test('every PowerShell call runs one at a time', async ($, on) => {
  let active = 0
  let most = 0
  const { clock } = world(on, 'Windows_NT', {
    run: () => {
      active += 1
      most = Math.max(most, active)
      active -= 1

      return OK
    },
  })
  await startSession($)
  await longTurn($, clock)

  expect(most).toBe(1)
})

const SPINNER = {
  plugin: 'learn-while-waiting',
  component: 'Spinner',
  props: { word: 'Thinking', message: null, suffix: '…', state: 'thinking' },
} as never

const PANE = {
  plugin: 'learn-while-waiting',
  component: 'Pane',
  requestId: 'learn-while-waiting',
  props: {
    title: 'Learn while waiting',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as never

const engineSpinner = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

test('the spinner shows a video beside the engine word on the desktop', async ($, on) => {
  world(on, 'Windows_NT')
  engineSpinner(on)
  await startSession($)
  const ui = await $.ui.mount({ ...(SPINNER as object), surface: 'desktop' } as never)

  expect(await ui.find({ type: 'Text', text: /🎓/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Thinking/ })).toBeDefined()
  await ui.unmount()
})

test('the spinner is left to the engine in a terminal, off Windows and when off', async ($, on) => {
  world(on, 'Windows_NT')
  engineSpinner(on)
  await startSession($)
  const terminal = await $.ui.mount({ ...(SPINNER as object), surface: 'terminal' } as never)
  expect((await terminal.find({ type: 'Text' }))?.text).toBe('engine')
  await terminal.unmount()

  await learn($, 'off')
  const off = await $.ui.mount({ ...(SPINNER as object), surface: 'desktop' } as never)
  expect((await off.find({ type: 'Text' }))?.text).toBe('engine')
  await off.unmount()
})

test('the spinner is left to the engine off Windows', async ($, on) => {
  world(on, undefined)
  engineSpinner(on)
  await startSession($)
  const ui = await $.ui.mount({ ...(SPINNER as object), surface: 'desktop' } as never)

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('the pane draws on every surface', async ($, on) => {
  world(on, 'Windows_NT')
  await startSession($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...(PANE as object), surface } as never)
    expect(await ui.find({ type: 'Text', text: /Up next time Claude takes a while/ })).toBeDefined()
    expect(await ui.find({ key: 'next' })).toBeDefined()
    expect(await ui.find({ key: 'toggle' })).toBeDefined()
    expect(await ui.find({ text: /Windows only/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the pane says Windows only elsewhere', async ($, on) => {
  world(on, undefined)
  await startSession($)
  const ui = await $.ui.mount({ ...(PANE as object), surface: 'desktop' } as never)

  expect(await ui.find({ type: 'Text', text: /Windows only/ })).toBeDefined()
  await ui.unmount()
})

test('the pane buttons switch the mod off and on and pick another video', async ($, on) => {
  const { stored } = world(on, 'Windows_NT')
  await startSession($)
  const ui = await $.ui.mount({ ...(PANE as object), surface: 'desktop' } as never)

  const words = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')
  const before = await words()
  await ui.press({ key: 'next' })
  expect(await words()).not.toBe(before)

  await ui.press({ key: 'toggle' })
  expect(stored['learn.enabled']).toBe(false)
  expect(await ui.find({ type: 'Text', text: /Off: no video will open/ })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect(stored['learn.enabled']).toBe(true)
  await ui.unmount()
})
