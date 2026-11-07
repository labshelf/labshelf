# Log: Advanced switch for notes

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->
- 2026-11-06 23:09 — plan.yaml filled: goal, decisions D1-D12 (D10 supersedes notebook-flow D8/D9/D10 for Reading mode; D12 records owns collisions), acceptance A1-A7, four sessions
- 2026-11-06 23:09 — sessions/1.yaml 1.1 (state, flag, handle, root class, CSS swap; opus-free) and 1.2 (cell off/on modes, opus) written; plan from-brief not used because it copies every brief edit into each spec and breaks owns
- 2026-11-06 23:09 — sessions/2.yaml 2.1 (note bar switch and header) and 2.2 (mountNoteFile always-bar, reader and space notes) written
- 2026-11-06 23:09 — sessions/3.yaml 3.1 (gutter bars, opus) and 3.2 (current block, opus) written
- 2026-11-06 23:09 — sessions/4.yaml 4.1 (host store tests), 4.2 (docs), 4.3 (hand check) written; tests are hidden: [] placeholders, to be written after approval; plan lint silent
- 2026-11-06 Approved by the user; sessions 1-4 implemented in the main thread (no hidden tests: the tests live with the code: currentBlock.test.ts, the Advanced cases in noteBar, foldCommands, mountNoteFile, lineGutter, noteViewState). Risks: notebook-flow S6 and cell-params S5 only wait on by-hand checks, so no code collides; qmdEditor.ts and codeCellView.ts were split (bindViewStateAndOutline to noteOutline.ts; noteCode, positionLabel, removeCellAt to cellLine.ts) to stay under 400 lines. Left: A7 by hand in VS Code and the browser.
- 2026-11-07 D16 (user request): with Advanced on, the text block that takes the caret shows its source in a plain editor (blockSource.ts), read back as typed; the current block's ground reaches past the sides only, so it no longer covers the neighbouring blocks.
