# Session 3 — Verify both hosts and parity

- **Wave:** 3, runs alone
- **Starts from:** 2a, 2b and 2c committed; the user approved launching a @vscode/test-electron host
- **Ends with:** A15, A16, A20 in both hosts; A8 against real files; parity screenshots
- **Commit:** yes, fixes found here
- **Research:** mockup.md

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | VS Code host: tree, reveal before ready, selection mark, file tray on real files, Describe… round-trip | — | `verify` (extension host, light, dark, high contrast) | A8, A15, A16, R4 | [ ] |
| 3.2 | Browser page: side bar, reveal, tray, Describe… | — | `verify` (headless browser page, light, dark) | A8, A15, A17–A19 | [ ] |
| 3.3 | Parity: same paper, same folder, both hosts next to `research/mockup/` | 3.1, 3.2 | H · main thread | A20; mismatches in log.md | [ ] |
| 3.4 | Fix mismatches, finish, commit | 3.3 | M · implementer, `finish`, `commit-splitter` | gate passes; A21 | [ ] |

## 3.1 — VS Code
Use a @vscode/test-electron copy on a copy of the library (memory `extension-host-e2e-recipe`); never the installed VS Code, never kill VS Code by name, stop only the launched PID. Ask the user before launching.

## 3.2 — Browser
Headless page per memory `webview-smoke-test-headless-chromium`. Can run while 3.1 runs.

## Carried from 2a
- A8 and A18 are open in the core webview: the webview has no `ILogger`, so a failed file listing goes to `console.warn` plus an error toast. `vscode` `paperFileHandlers` does not log a failed listing that the port returns. Log it at the host source.
- The filterBar status tabs and folder chip stay until VS Code sends the host→UI status-scope message.
- Fixture check: the synthetic note row reads "Note  Note Empty" (name and fact label repeat). Decide on the real library whether the fact label goes.
