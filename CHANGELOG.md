# Changelog

## 0.3.1

- Fixed: the video kept playing after Claude finished when it had only just opened; pausing now retries for a few seconds.
- Fixed: the browser no longer comes forward if Claude finished while the video was opening.
- A new video now reuses the browser tab already showing YouTube instead of opening another tab each time. It opens a new tab only when there is none, or when that window can't be brought to the front.

## 0.3.0

- Fixed: turning the mod off with `/learn off` while a wait was running still opened a video when the wait ended.
- Fixed: `/learn wait 15abc` and `/learn wait 1.5` were accepted as 15 and 1; only whole seconds from 0 to 300 are now.
- The test suite grew from 6 to 43 tests: resuming and replacing the video, failed opens, pauses and resumes, YouTube being unreachable, saved and damaged settings, the spinner and pane on every surface, and `/learn` input limits.
- The marketplace now has a description, and the manifest has a homepage, repository and keywords.

## 0.2.0

- A video now opens only after Claude has been working for a few seconds (default 8), so short answers no longer flash the browser. Set it with `/learn wait <seconds>`.
- `/learn on` and `/learn off` turn the mod on and off, and the choice is kept across sessions. The pane has a button for it too.
- The mod no longer slows down the start of a turn: its PowerShell work runs in the background, one job at a time.
- On systems other than Windows the mod does nothing instead of failing.
- Subagents' turns no longer start videos.
- Automated tests added.

## 0.1.0

- First version: opens a video while Claude works, pauses it and returns to the previous window when Claude finishes, and resumes it on the next turn.
