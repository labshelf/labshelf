# Log: Notes in Quarto Markdown everywhere

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->
- 2026-10-22 — plan: Q1–Q5 answered with the recommendations; status in progress.
- 2026-10-22 — 1.1 contract documents/contracts/qmd-items.md written; indexed in documents/README.md.
- 2026-10-22 — 1.2 ids/anchors done in main thread. Deviation: ids come from `itemIdGenerator(now, random)` (state needed for monotonic ids); `newItemId` is its default instance.
- 2026-10-22 — 1.3 items/outputs done in main thread. Deviations: an unclosed opening line is one loose line and later items still read (not "whole tail loose"); div openers follow Pandoc (not after paragraph text); code fences follow Pandoc's opener grammar; edits reparse the file and throw if anything else would read differently; BOM kept as loose text; CRLF/CR/no-final-newline fixtures are built in memory (qmdFixtures.ts) so git never rewrites them. Low-level line/div helpers stay out of the core root export.
- 2026-10-22 — 1.4 review (general subagent as reviewer): 2 blocking, 9 non-blocking, all fixed except `findCell(body, label)`, deferred to the first consumer (session 3 or 12).
- 2026-10-22 — 1.5 gate: pnpm -r typecheck passes; core tests 6480 pass, 2 relay timing tests fail (relayOutage, relayTransport; no qmd code involved); app tests not run. Peak context: main ~95k, reviewer subagent not reported.
