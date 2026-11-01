# learn-while-waiting 🎓

**Never stare at a spinner again.**

Every time you ask an AI a question or hand it a task, there's the same dead time: you hit send, then you wait. This mod turns that wait into learning time. While Claude is thinking, you're watching a short, genuinely good video on science, maths or computing, and the moment your answer or task is done, you're pulled straight back to Claude. Pass the time, learn something, lose nothing.

## How it works

When Claude has been working for a few seconds, the mod opens a short educational YouTube video (3Blue1Brown, Veritasium, Kurzgesagt and similar) in your browser and brings the browser to the front. When Claude finishes, it pauses the video and puts you back in the window you were in. On your next long wait it resumes the same video, or opens a new one if you closed it. Short answers never open anything.

It also adds a "Learn while waiting" pane showing the current video, with buttons to watch, resume, skip to another one, and turn the mod on or off.

**Windows only.** It works with Chrome, Edge, Firefox, Brave, Opera and Vivaldi. On any other system the mod stays quiet and does nothing.

## Install

Two commands, run in any shell:

```
claude plugin marketplace add avolcoff/claude-learn-while-waiting
```

```
claude plugin install learn-while-waiting@claude-learn-while-waiting
```

Then restart Claude. In a terminal Claude Code session you can instead type `/plugin install learn-while-waiting --marketplace avolcoff/claude-learn-while-waiting`.

If your `claude` command is older and doesn't know `plugin`, use the copy the Claude desktop app bundles, at `%APPDATA%\Claude\claude-code\<version>\<id>\claude.exe`.

To remove it: `claude plugin uninstall learn-while-waiting`.

## Use

| Command | What it does |
| --- | --- |
| `/learn` | Opens the pane and shows whether the mod is on |
| `/learn off` | Stops it opening videos (kept across sessions) |
| `/learn on` | Turns it back on |
| `/learn wait 15` | Waits 15 seconds into a turn before opening a video (default 8, 0 to 300) |

Subagents' turns never start a video; only your own messages do.

## What it accesses

Everything runs on your computer. The only network request goes to YouTube.

- **YouTube:** it fetches a YouTube search results page to find the video, then opens it in your browser.
- **Browser windows:** it reads the titles of your open browser windows to find the one showing YouTube. It reads nothing else about them.
- **Media controls:** it asks Windows' media controls to pause and play your browser's video.
- **Window focus:** it brings the browser forward and back by simulating a press of the Alt key (Windows needs this to allow a program to take the focus).
- **PowerShell:** all of the above run as short PowerShell commands.
- **Settings:** it saves two values in Claude's own storage: whether it is on, and the wait.

It does not read your messages, your files or Claude's replies. The source is in `hooks/register.tsx`.

## Limits

- The video plays in your browser, not inside Claude: mods have no element that can host a web player.
- It finds the video by looking for a browser window whose active tab is titled YouTube. If you move to another tab in that window, it can't find the video, and may open a new one.
- The video is the top YouTube search result for each title, so a removed or renamed video can be replaced by a similar one. If YouTube changes its search page, the mod opens the search results instead, which don't autoplay.
- Windows decides who may take the focus. If it refuses, the browser opens behind your window and you are not switched back.

## Development

```
claude plugin validate .
claude plugin test .
```

The tests in `tests/` cover the main behaviour with a mocked clock: nothing runs off Windows, a short turn opens nothing, a long turn opens the video and later pauses it and goes back, and the on/off and wait settings work.

## License

MIT
