# Changelog

## 0.2.0

- A video now opens only after Claude has been working for a few seconds (default 8), so short answers no longer flash the browser. Set it with `/learn wait <seconds>`.
- `/learn on` and `/learn off` turn the mod on and off, and the choice is kept across sessions. The pane has a button for it too.
- The mod no longer slows down the start of a turn: its PowerShell work runs in the background, one job at a time.
- On systems other than Windows the mod does nothing instead of failing.
- Subagents' turns no longer start videos.
- Automated tests added.

## 0.1.0

- First version: opens a video while Claude works, pauses it and returns to the previous window when Claude finishes, and resumes it on the next turn.
