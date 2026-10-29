# Log: Notes in Quarto Markdown everywhere

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->
- 2026-10-22 — plan: Q1–Q5 answered with the recommendations; status in progress.
- 2026-10-22 — 1.1 contract documents/contracts/qmd-items.md written; indexed in documents/README.md.
- 2026-10-22 — 1.2 ids/anchors done in main thread. Deviation: ids come from `itemIdGenerator(now, random)` (state needed for monotonic ids); `newItemId` is its default instance.
- 2026-10-22 — 1.3 items/outputs done in main thread. Deviations: an unclosed opening line is one loose line and later items still read (not "whole tail loose"); div openers follow Pandoc (not after paragraph text); code fences follow Pandoc's opener grammar; edits reparse the file and throw if anything else would read differently; BOM kept as loose text; CRLF/CR/no-final-newline fixtures are built in memory (qmdFixtures.ts) so git never rewrites them. Low-level line/div helpers stay out of the core root export.
- 2026-10-22 — 1.4 review (general subagent as reviewer): 2 blocking, 9 non-blocking, all fixed except `findCell(body, label)`, deferred to the first consumer (session 3 or 12).
- 2026-10-22 — 1.5 gate: pnpm -r typecheck passes; core tests 6480 pass, 2 relay timing tests fail (relayOutage, relayTransport; no qmd code involved); app tests not run. Peak context: main ~95k, reviewer subagent not reported.
- 2026-10-22 23:49 — 2.1 qmd/merge done in main thread (threeWay, attributeMerge, outputMerge, itemMerge, itemOrder, mergeItemFiles); 14 tests. Deviations: returns {text, conflicted} like the line merge (drop-in); a both-sided attribute change keeps local unless local removed it; a merged body that would break fences keeps both versions as two items with one id; separators get one blank line between an added item and its neighbour; throws when the result would not reparse as the merged items.
- 2026-10-22 23:54 — 2.2 project .qmd mergeable; mergeFileText in writing/merge/node/mergeText.ts dispatches copy and divergence merges. Deviation: a project .qmd copy without a base merges as a union (as in papers and Spaces).
- 2026-10-22 23:54 — 2.3 library/conflicts/node/itemFiles/ (copy merge, paper notes, Space walk); scanConflictCopies and scanSpaceConflicts take the version store; scopes paper_<id>/space_<id> passed as is; PAPER_NOTES_FILE in layout.ts; keepBoth left out for paper notes.qmd (conflictCopy.ts, outside Owns).
- 2026-10-22 23:54 — 2.4 contracts: qmd-items#merge holds the rules; sync.md, library-format.md, spaces.md link to it.
- 2026-10-23 — 2.5 review (general subagent as reviewer): 4 blocking fixed — a base sharing no item with a side counts as no base; item files never take a copy's text as base (projects too); a non-UTF-8 notes file is kept; item-file merges moved to writing/merge/node/itemFiles/ (called from libraryConflictScan, library scans unchanged) to avoid a library↔writing cycle. Non-blocking fixed: contract wording (file vs other, id-order check), copies kept on scan errors, CONTRACT tags, changedSide split out. Open: base folder names `paper_<id>`/`space_<id>` can collide with a project id of that form; gap between change re-check and write; seed read per file on every scan; no pruning of bases; one-sided reorder undone; base staleness resurrects deletes of items newer than the base.
- 2026-10-23 — 2.6 gate: pnpm -r typecheck passes; core tests 6538 pass, relayOutage fails (baseline); app tests not run (no app code changed). Peak context: main ~120k, reviewer not reported.
- 2026-10-28 — plan: converted to plan.yaml and sessions/*.yaml (YAML flow); sessions 1–3 recorded as done; paths updated to the current code layout.
- 2026-10-28 — plan: hidden tests written by testers for every spec with tests; specs completed from the tester reports (seams, decided, by-hand checks split into task specs); plan red passes for 4.3.
- 2026-10-28 18:27 — session 4 done: 4.1, 4.2, 4.3, 4.4
- 2026-10-28 18:34 — session 5 blocked: 5.3: no report
- 2026-10-28 20:38 — session 6 blocked: 6.3: blocked_tests
- 2026-10-28 21:07 — session 6 done: 6.1, 6.3, 6.4
- 2026-10-28 21:37 — session 6b blocked: 6.5: missing
- 2026-10-28 21:39 — session 6b done: 6.5, 6.5r, 6.6, 6.7, 6.7r, 6.8
- 2026-10-28 23:12 — session 7 blocked: 7.1: no report; 7.3: missing; 7.5: blocked_tests
- 2026-10-28 23:22 — session 7 done: 7.1, 7.2, 7.3, 7.5, 7.7, 7.8
- 2026-10-29 00:02 — session 7b done: 7.4, 7.6, 7.7
