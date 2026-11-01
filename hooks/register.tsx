import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const PANE = 'learn-while-waiting'

// Each entry opens a YouTube search whose top result is the named video, so a
// renamed or re-uploaded video still lands somewhere sensible.
const VIDEOS = [
  { title: 'But what is a neural network?', channel: '3Blue1Brown' },
  { title: 'The Most Misunderstood Concept in Physics (entropy)', channel: 'Veritasium' },
  { title: 'How does a CPU actually work?', channel: 'Branch Education' },
  { title: 'The Fermi Paradox — Where Are All The Aliens?', channel: 'Kurzgesagt' },
  { title: 'Why do prime numbers make these spirals?', channel: '3Blue1Brown' },
  { title: 'How Does Public Key Cryptography Work', channel: 'Computerphile' },
  { title: 'The Simple Solution to Traffic', channel: 'CGP Grey' },
  { title: 'Inventing the Transistor', channel: 'Veritasium' },
  { title: 'How Do Vaccines Work?', channel: 'Kurzgesagt' },
  { title: 'Transformers, the tech behind LLMs', channel: '3Blue1Brown' },
  { title: 'How GPS Works', channel: 'Branch Education' },
  { title: 'The Bayesian Trap', channel: 'Veritasium' },
  { title: 'Why the Universe Is Expanding', channel: 'PBS Space Time' },
  { title: 'How the Internet Works in 5 Minutes', channel: 'Aaron Titus' },
  { title: 'The Banach–Tarski Paradox', channel: 'Vsauce' },
  { title: 'What is Game Theory?', channel: 'TED-Ed' },
  { title: 'How Does a Nuclear Reactor Work?', channel: 'Real Engineering' },
  { title: 'The Map of Mathematics', channel: 'Domain of Science' },
  { title: 'Hash Tables and Hash Functions', channel: 'Computer Science' },
  { title: 'Why Is Blue So Rare In Nature?', channel: 'Be Smart' },
]

// Pauses or plays the browser's media session through Windows' media
// controls, so only the browser is touched and a paused video never toggles
// back on. Prints how many browser sessions it changed. Pausing keeps trying
// for a few seconds, since a video that was only just opened may not be
// playing yet and would otherwise keep going after Claude is done.
const mediaScript = (action: 'Pause' | 'Play' | 'Count') => `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Await($op, $type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
for ($try = 0; $try -lt ${action === 'Pause' ? 10 : 1}; $try++) {
  $changed = 0; $count = 0; $settled = $false
  foreach ($s in $manager.GetSessions()) {
    if ($s.SourceAppUserModelId -notmatch 'chrome|msedge|firefox|brave|opera|vivaldi') { continue }
    $count++
    $status = [string]$s.GetPlaybackInfo().PlaybackStatus
    if ('${action}' -eq 'Pause' -and $status -eq 'Paused') { $settled = $true }
    if ('${action}' -eq 'Pause' -and $status -eq 'Playing' -and (Await ($s.TryPauseAsync()) ([bool]))) { $changed++ }
    if ('${action}' -eq 'Play' -and $status -eq 'Paused' -and (Await ($s.TryPlayAsync()) ([bool]))) { $changed++ }
  }
  if ($changed -gt 0 -or $settled) { break }
  # A video just opened with autoplay may not be playing yet: try again shortly.
  if ($try -lt ${action === 'Pause' ? 9 : 0}) { Start-Sleep -Milliseconds 500 }
}
if ('${action}' -eq 'Count') { $count } else { $changed }
`

// Sent as -EncodedCommand (base64 of UTF-16LE) so its quotes survive
// Windows' command-line quoting.
const encodeForPowerShell = (script: string) =>
  btoa([...script].map(c => String.fromCharCode(c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8)).join(''))

const mediaCommand = (action: 'Pause' | 'Play' | 'Count') => [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  encodeForPowerShell(mediaScript(action)),
]

const pick = atom({ plugin: 'learn-while-waiting', key: 'pick' } as const, 0)
const isWorking = atom({ plugin: 'learn-while-waiting', key: 'isWorking' } as const, false)
const isPlaying = atom({ plugin: 'learn-while-waiting', key: 'isPlaying' } as const, false)
const isPausedByUs = atom({ plugin: 'learn-while-waiting', key: 'isPausedByUs' } as const, false)
// The window the person was in before the browser came forward, to go back to.
const isEnabled = atom({ plugin: 'learn-while-waiting', key: 'isEnabled' } as const, true)
const waitSeconds = atom({ plugin: 'learn-while-waiting', key: 'waitSeconds' } as const, 8)
const returnTo = atom({ plugin: 'learn-while-waiting', key: 'returnTo' } as const, '')

// 'save' prints the window that has the focus; 'front' raises the browser
// window showing YouTube (waiting up to 5s for its title to say so); 'back'
// raises the given window, else the Claude app's.
const windowScript = (action: 'save' | 'front' | 'back', target: string) => `
Add-Type @'
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);
}
'@
function Raise($h) {
  if ([W]::IsIconic($h)) { [W]::ShowWindow($h, 9) | Out-Null }
  [W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [W]::SetForegroundWindow($h) | Out-Null
}
if ('${action}' -eq 'save') {
  [W]::GetForegroundWindow().ToInt64()
} elseif ('${action}' -eq 'front') {
  $w = $null
  for ($i = 0; $i -lt 10 -and -not $w; $i++) {
    $w = Get-Process chrome, msedge, firefox, brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'YouTube' } | Select-Object -First 1
    if (-not $w) { Start-Sleep -Milliseconds 500 }
  }
  if ($w) { Raise $w.MainWindowHandle }
} else {
  $t = [IntPtr][long]${/^\d+$/.test(target) ? target : '0'}
  if ($t -eq [IntPtr]::Zero) {
    $c = Get-Process claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($c) { $t = $c.MainWindowHandle }
  }
  if ($t -ne [IntPtr]::Zero) { Raise $t }
}
`

const powershell = (script: string) => [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  encodeForPowerShell(script),
]

// Notes the window the person is in, before a video opens and takes the focus.
const rememberWindow = async ($: EngineInterface) => {
  try {
    const ran = await $.process.run(powershell(windowScript('save', '')))
    await update($, returnTo, () => ran.stdout.trim())
  } catch {}
}

// Brings the video's browser window forward.
const showVideo = async ($: EngineInterface) => {
  try {
    await $.process.run(powershell(windowScript('front', '')))
  } catch {}
}

// Returns the person to the window they were in, else the Claude app.
const hideVideo = async ($: EngineInterface) => {
  const target = await read($, returnTo)
  await update($, returnTo, () => '')
  try {
    await $.process.run(powershell(windowScript('back', target)))
  } catch {}
}

// Points the browser window that already shows YouTube at a new address, so a
// new video reuses its tab instead of opening another. Prints 'ok' only when
// that window really had the focus for the typing, else nothing was typed.
const navigateScript = (url: string) => `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices;
public class N {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);
}
'@
$w = Get-Process chrome, msedge, firefox, brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'YouTube' } | Select-Object -First 1
if ($w) {
  $h = $w.MainWindowHandle
  if ([N]::IsIconic($h)) { [N]::ShowWindow($h, 9) | Out-Null }
  [N]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [N]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [N]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 400
  $front = [N]::GetForegroundWindow()
  if ($front.ToInt64() -eq $h.ToInt64()) {
    [System.Windows.Forms.SendKeys]::SendWait('^l')
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait('${url.replace(/[+^%~(){}[\]]/g, '{$&}').replace(/'/g, "''")}')
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    'ok'
  }
}
`

// True when the existing YouTube tab was sent to the address.
const reuseTab = async ($: EngineInterface, url: string) => {
  try {
    const ran = await $.process.run(powershell(navigateScript(url)))

    return ran.exitCode === 0 && ran.stdout.trim() === 'ok'
  } catch {
    return false
  }
}

const videoAt = (index: number) => VIDEOS[((index % VIDEOS.length) + VIDEOS.length) % VIDEOS.length]!

const urlOf = (video: (typeof VIDEOS)[number]) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${video.title} ${video.channel}`)}`

// The search's top result as a watch page that starts playing on load; the
// search page itself when YouTube can't be reached or answers unexpectedly.
const playableUrlOf = async ($: EngineInterface, video: (typeof VIDEOS)[number]) => {
  try {
    const page = await $.http.fetch(urlOf(video), { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const id = page.text.match(/"videoId":"([A-Za-z0-9_-]{11})"/)?.[1]
    if (id) {
      return `https://www.youtube.com/watch?v=${id}&autoplay=1`
    }
  } catch {}

  return urlOf(video)
}

const watch = async ($: EngineInterface) => {
  const video = videoAt(await read($, pick))
  const url = await playableUrlOf($, video)
  // Reuse the YouTube tab if there is one; only open a new tab when there isn't.
  if (!(await reuseTab($, url))) {
    try {
      await $.process.run(['rundll32.exe', 'url.dll,FileProtocolHandler', url])
    } catch (error) {
      $.ui.toast(`Couldn't open the video: ${String(error)}`)
      return
    }
  }
  await update($, isPlaying, () => true)
  await update($, isPausedByUs, () => false)
}

// How many browser windows show a YouTube tab. A paused video's media session
// can lapse while its window stays, so the sessions alone can't say it's gone.
const YOUTUBE_WINDOWS = `(Get-Process chrome, msedge, firefox, brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'YouTube' } | Measure-Object).Count`

// True while the video is still there: a browser media session or a YouTube window.
const hasVideo = async ($: EngineInterface) => {
  try {
    for (const argv of [mediaCommand('Count'), powershell(YOUTUBE_WINDOWS)]) {
      const ran = await $.process.run(argv)
      if (ran.exitCode === 0 && Number.parseInt(ran.stdout.trim(), 10) > 0) {
        return true
      }
    }
  } catch {}

  return false
}

// True when a browser video was paused or played.
const setPlayback = async ($: EngineInterface, action: 'Pause' | 'Play', isLoud = true) => {
  const verb = action === 'Pause' ? 'pause' : 'resume'
  try {
    const ran = await $.process.run(mediaCommand(action))
    if (ran.exitCode !== 0) {
      $.ui.toast(`Couldn't ${verb} the video: ${ran.stderr.slice(0, 200)}`)
      return false
    }
    if (Number.parseInt(ran.stdout.trim(), 10) > 0) {
      return true
    }
    if (isLoud) $.ui.toast(`No browser video to ${verb}`)
  } catch (error) {
    $.ui.toast(`Couldn't ${verb} the video: ${String(error)}`)
  }

  return false
}

// Everything that starts a process runs one after another in the background,
// so a turn never waits on PowerShell.
let queue: Promise<unknown> = Promise.resolve()
const enqueue = (job: () => Promise<unknown>) => {
  queue = queue.then(job).catch(() => undefined)
}

// The window helpers need Windows; set at session start.
let isWindows = false
// Which turn a pending start belongs to; a finished turn cancels it.
let turnToken = 0
// Whether this turn brought the browser forward, so only then is it sent back.
let didShow = false

const DEFAULT_WAIT_SECONDS = 8
const MAX_WAIT_SECONDS = 300

// The video side of a turn that has run long enough: resume the paused video,
// else open the next one, and bring the browser forward.
const startVideo = async ($: EngineInterface, token: number) => {
  // Turning the mod off during the wait cancels the video that wait was for.
  if (token !== turnToken || !(await read($, isEnabled))) {
    return
  }
  await rememberWindow($)
  // A closed tab or window leaves nothing to resume: start over with a new one.
  const exists = await hasVideo($)
  if (!exists) {
    await update($, isPlaying, () => false)
    await update($, isPausedByUs, () => false)
  }
  if (exists && (await read($, isPausedByUs))) {
    await update($, isPausedByUs, () => false)
    if (await setPlayback($, 'Play', false)) {
      await update($, isPlaying, () => true)
    } else {
      await update($, pick, n => n + 1)
      await watch($)
    }
  } else if (!(exists && (await read($, isPlaying)))) {
    await update($, pick, n => n + 1)
    await watch($)
  }
  // The turn may have ended while the video was opening: don't pull the
  // browser forward after Claude has already answered.
  if (token === turnToken && (await read($, isPlaying))) {
    await showVideo($)
    didShow = true
  }
}

// The turn is over: pause the video, and go back only if the browser came forward.
const finishVideo = async ($: EngineInterface) => {
  if (await read($, isPlaying)) {
    await update($, isPlaying, () => false)
    if ((await hasVideo($)) && (await setPlayback($, 'Pause'))) {
      await update($, isPausedByUs, () => true)
      $.ui.toast("Claude's back, so the video is paused")
    }
  }
  if (didShow) {
    didShow = false
    await hideVideo($)
  }
}

const setEnabled = async ($: EngineInterface, value: boolean) => {
  await update($, isEnabled, () => value)
  await $.store.set('learn.enabled', value)
}

const statusText = async ($: EngineInterface) =>
  `Learn-while-waiting is ${(await read($, isEnabled)) ? 'on' : 'off'}; the video starts after ${await read($, waitSeconds)}s of waiting.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isWindows = (await $.env.get('OS')) === 'Windows_NT'
    await $.command.register({
      name: 'learn',
      description: 'Learn while waiting: /learn opens the pane, /learn on|off, /learn wait <seconds>',
    })
    await update($, pick, () => Math.floor(Math.random() * VIDEOS.length))
    const savedEnabled = await $.store.get('learn.enabled')
    await update($, isEnabled, () => savedEnabled !== false)
    const savedWait = await $.store.get('learn.wait')
    const wait =
      typeof savedWait === 'number' && Number.isInteger(savedWait) && savedWait >= 0 && savedWait <= MAX_WAIT_SECONDS
        ? savedWait
        : DEFAULT_WAIT_SECONDS
    await update($, waitSeconds, () => wait)
    void $.ui.open({ id: PANE, title: 'Learn while waiting' })

    return next(e)
  })

  on('command.run', { command: 'learn' }, async ($, e) => {
    const [word = '', arg = ''] = e.args.trim().split(/\s+/)
    if (word === 'on' || word === 'off') {
      await setEnabled($, word === 'on')
    } else if (word === 'wait') {
      // Whole seconds only: "15abc" or "1.5" is a typo, not 15 or 1.
      const seconds = /^\d+$/.test(arg) ? Number.parseInt(arg, 10) : Number.NaN
      if (!Number.isFinite(seconds) || seconds > MAX_WAIT_SECONDS) {
        return { text: `Usage: /learn wait <seconds, 0 to ${MAX_WAIT_SECONDS}>` }
      }
      await update($, waitSeconds, () => seconds)
      await $.store.set('learn.wait', seconds)
    } else {
      await $.ui.open({ id: PANE, title: 'Learn while waiting' })
    }
    const note = isWindows ? '' : ' It only works on Windows, so nothing will open here.'

    return { text: `${await statusText($)}${note}` }
  })

  // Claude is working: after the wait, open or resume the video. This hook only
  // sets a timer, so it never holds the turn up.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isWorking, () => true)
      if (isWindows && e.text !== '' && (await read($, isEnabled))) {
        turnToken += 1
        const token = turnToken
        const seconds = await read($, waitSeconds)
        $.clock.after(seconds * 1000, () => enqueue(() => startVideo($, token)))
      }
    }

    return next(e)
  })

  // Claude is back: cancel a start still waiting, and pause the video.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isWorking, () => false)
      turnToken += 1
      enqueue(() => finishVideo($))
    }

    return next(e)
  })

  // The thinking row: keep the engine's word, add the video beside it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface === 'terminal' || !isWindows || !(await read($, isEnabled))) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const video = videoAt(await read($, pick))
    const playing = await read($, isPlaying)

    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{e.props.message ?? e.props.word}…</Text>
        <Text>🎓 {video.title} ({video.channel})</Text>
        {!playing && <Button key="watch" label="▶ Watch" onPress={() => enqueue(() => watch($))} />}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const video = videoAt(await read($, pick))
    const working = await read($, isWorking)
    const playing = await read($, isPlaying)
    const paused = await read($, isPausedByUs)
    const enabled = await read($, isEnabled)
    const seconds = await read($, waitSeconds)

    return (
      <Box flexDirection="column" gap={1}>
        {!isWindows && <Text>Windows only: nothing will open on this system.</Text>}
        <Text dimColor>
          {working ? 'Claude is working, so learn something meanwhile:' : 'Up next time Claude takes a while:'}
        </Text>
        <Text bold>{video.title}</Text>
        <Text dimColor>{video.channel}</Text>
        {paused && <Text dimColor>Paused when Claude answered.</Text>}
        <Box flexDirection="row" gap={1}>
          {paused ? (
            <Button
              key="resume"
              label="▶ Resume"
              onPress={async () => {
                if (!(await setPlayback($, 'Play'))) return
                await update($, isPlaying, () => true)
                await update($, isPausedByUs, () => false)
              }}
            />
          ) : (
            !playing && <Button key="watch" label="▶ Watch on YouTube" onPress={() => enqueue(() => watch($))} />
          )}
          <Button
            key="next"
            label="Another one"
            onPress={async () => {
              await update($, pick, n => n + 1)
              await update($, isPausedByUs, () => false)
              await update($, isPlaying, () => false)
            }}
          />
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>
            {enabled ? `On: starts after ${seconds}s of waiting` : 'Off: no video will open'}
          </Text>
          <Button key="toggle" label={enabled ? 'Turn off' : 'Turn on'} onPress={() => setEnabled($, !enabled)} />
        </Box>
      </Box>
    )
  })
}
