# Log: writing from the browser extension

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. -->
- 2026-10-17 — 1b done: runtime messages split into platform/messages/ (WritingMessage stays outside RuntimeMessage until session 3 routes it); reader protocol.ts split into reader/protocol/ (2d's 'protocol.ts:130-200' is now protocol/webviewToHost.ts + webviewGuard.ts); commit 2ad77369.
- 2026-10-17 — 1a done: library project store (`createBrowserProjects`), shared `readProjectEntry` and `relativePathProblem` in core. Left: registered external projects — the bridge refuses paths outside the library root and cannot read the device registry; needs a bridge contract change.; commit "feat(browser): list and read library writing projects through the bridge".
