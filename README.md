# learn-while-waiting

A mod for Claude Code Desktop that gives you something to learn while Claude works. When you send a message, it opens a short educational YouTube video (3Blue1Brown, Veritasium, Kurzgesagt and similar), brings the browser to the front, and plays it. When Claude finishes, it pauses the video and puts you back in the window you were in. On your next message it resumes the same video, or opens a new one if you closed it.

It also adds a "Learn while waiting" pane (open it with `/learn`) showing the current video, with buttons to watch, resume or skip to another one.

**Windows only.** It uses Windows window and media controls, and works with Chrome, Edge, Firefox, Brave, Opera and Vivaldi.

## Install

At the prompt of a terminal session:

```
/plugin install learn-while-waiting --marketplace avolcoff/claude-learn-while-waiting
```

From a shell:

```
claude plugin install learn-while-waiting --marketplace avolcoff/claude-learn-while-waiting
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `avolcoff/claude-learn-while-waiting`, then Add plugin.

## How it works

- The video can't play inside Claude's own window: mods have no element that can host a web player. So it plays in your browser.
- Pausing and resuming go through Windows' media controls, so only the browser is touched.
- Your window is noted when a turn starts and restored when the video pauses.

## Limits

- It finds the video by looking for a browser window whose active tab is titled YouTube.
- The browser window jumps to the front at the start of every turn, even if you are typing in another app.
- The videos are looked up by title on YouTube, so a video that was removed or renamed may be replaced by a similar result.
