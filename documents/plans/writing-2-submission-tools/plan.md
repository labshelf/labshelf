# Plan: submission tools

Status: in progress (the rebuttal remains)
Size: 3 sessions — one contract-level store with a splitter, one panel with a letter export, one gate

## 1. Goal

LabShelf carries a paper from the experiments to the camera-ready: figures and numbers stay in step with the code that produces them, a check before submitting catches desk-reject mistakes, every submitted version is kept and comparable, and the rebuttal is organised comment by comment.

Builds on [writing-core.plan.md](../../archive/writing-core.plan.md). The terminal and CI side is in [writing-terminal](../writing-3-writing-terminal/plan.md). Running experiments, CI integration and AI drafting of replies are out.

## 2. Decisions

- [x] **D1** Figure provenance: `labshelf.yaml` maps each figure to the command that makes it and its inputs (`figures: {fig/ablation.pdf: {run: python plot_ablation.py, inputs: [plot_ablation.py, results/*.json]}}`). LabShelf marks a figure stale when an input is newer than it, and "Regenerate" runs the command (desktop only). Regenerate runs arbitrary commands, so it asks one confirmation per project on each machine and takes commands only from `labshelf.yaml`. — Only a tool that lives with the code can do this.
- [x] **D2** Live numbers: LaTeX projects get `\lsvalue{<file>.<path>}`, backed by a generated `labshelf-values.tex` built from the JSON files listed in `labshelf.yaml`; Typst reads JSON natively, so LabShelf only adds hover and completion over the same files. Hover shows the value and its source. — No number is copied by hand.
- [x] **D3** Pre-submission check, one command, results in Problems: page limit (from `labshelf.yaml` `check.pages`), anonymity (author names from `labshelf.yaml`, the git user and the PDF info dictionary; phrases like "our previous work"; GitHub or personal URLs), Type 3 fonts, raster figures under 300 dpi, unresolved references and citations. — Each item is a known desk-reject cause.
- [x] **D4** Versions: "Mark version" (submitted, rebuttal, camera-ready, or a free name) snapshots the sources and the PDF into `.labshelf/versions/<name>/`, synced with the project. "Compare" opens two versions side by side in the reader with changed regions highlighted from a page-image diff, tolerant of reflow; `latexdiff` is used when TeX Live has it. — Works for both formats with one mechanism.
- [x] **D5** Rebuttal panel: paste the reviews; LabShelf splits them into numbered points (editable), each a thread with status (open, addressed, won't fix) linked to source ranges through the comments of [writing-sync](../writing-2-writing-sync/plan.md); "Export response" writes a Markdown or LaTeX letter quoting each point, the reply and the changed passages from the version diff. The store is `core/src/writing/rebuttal/` (runtime-neutral, over injected ports) with the file `.labshelf/rebuttal/<round>.json`, documented in [library-format.md](../../contracts/library-format.md) in the same change; the panel is VS Code glue in `packages/vscode/src/writing/`. — The rebuttal is tracked, not juggled.

- [x] **Q1** Venue presets for the check: none; the user sets `check:` in `labshelf.yaml`. — Limits change every year, and a wrong preset is worse than none.

## 3. Acceptance

A1 and A2 pass in tests (A2 on a real pdflatex fixture); the run in a real extension host is open because the test host refuses modal dialogs.

- [ ] **A1** Editing `plot_ablation.py` marks `fig/ablation.pdf` stale in the Writing view; "Regenerate" runs the command and clears the mark.
- [ ] **A2** `\lsvalue{results.acc}` builds to the number in `results.json`; hovering it shows the value and file.
- [x] **A3** The check flags a 10-page PDF against `check.pages: 9`, the author's name in the PDF metadata, and a Type 3 font.
- [x] **A4** After "Mark version: submitted" and some edits, "Compare" highlights the changed regions on each page.
- [ ] **A5** Pasted reviews become numbered points; marking all addressed and exporting writes a letter with quotes, replies and changed passages.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | Rebuttal: review splitting, store, panel, letter export (A5) | `packages/core/src/writing/rebuttal/`, `packages/core/__tests__/writing/rebuttal/`, `packages/vscode/src/writing/rebuttal/`, `documents/contracts/library-format.md` | alone |

The figures, numbers, check and versions are finished and logged in [log.md](log.md). The plan directory is deleted after A1, A2 and A5 pass.
