# Plan: submission tools

Status: in progress (rebuttal session left; figures, check and versions are finished)
Size: GG — five features in core and VS Code, one of them a visual PDF diff; 4 sessions.
Pending decisions: 0

This plan uses the directory format. Read this file, then only `sessions/01.md`. `log.md` is append-only: add lines with `>>`, never read it whole.

## 1. Goal

LabShelf carries a paper from the experiments to the camera-ready: figures and numbers stay in step with the code that produces them, a check before submitting catches desk-reject mistakes, every submitted version is kept and comparable, and the rebuttal is organised comment by comment.

Builds on [writing-core.plan.md](../../archive/writing-core.plan.md). The terminal and CI side is in [writing-terminal](../writing-3-writing-terminal/plan.md).

## 2. Decisions

- [x] **D1** Figure provenance: `labshelf.yaml` maps each figure to the command that makes it and its inputs (`figures: {fig/ablation.pdf: {run: python plot_ablation.py, inputs: [plot_ablation.py, results/*.json]}}`). LabShelf marks a figure stale when an input is newer than it, and "Regenerate" runs the command (desktop only). — Only a tool that lives with the code can do this.
- [x] **D2** Live numbers: LaTeX projects get `\lsvalue{<file>.<path>}`, backed by a generated `labshelf-values.tex` built from the JSON files listed in `labshelf.yaml`; Typst reads JSON natively, so LabShelf only adds hover and completion over the same files. Hover shows the value and its source. — No number is copied by hand.
- [x] **D3** Pre-submission check, one command, results in Problems: page limit (from `labshelf.yaml` `check.pages`), anonymity (author names from `labshelf.yaml`, the git user and the PDF info dictionary; phrases like "our previous work"; GitHub or personal URLs), Type 3 fonts, raster figures under 300 dpi, unresolved references and citations. — Each item is a known desk-reject cause.
- [x] **D4** Versions: "Mark version" (submitted, rebuttal, camera-ready, or a free name) snapshots the sources and the PDF into `.labshelf/versions/<name>/`, synced with the project. "Compare" opens two versions side by side in the reader with changed regions highlighted from a page-image diff; `latexdiff` is used when TeX Live has it. — Works for both formats with one mechanism.
- [x] **D5** Rebuttal panel: paste the reviews; LabShelf splits them into numbered points (editable), each a thread with status (open, addressed, won't fix) linked to source ranges through the comments of [writing-sync](../writing-2-writing-sync/plan.md); "Export response" writes a Markdown or LaTeX letter quoting each point, the reply and the changed passages from the version diff. — The rebuttal is tracked, not juggled.

- [x] **Q1** Venue presets for the check: none; the user sets `check:` in `labshelf.yaml`. — Limits change every year, and a wrong preset is worse than none.

## 3. Scope

- **In:** core `writing/` (provenance, values, checks, versions, rebuttal), VS Code UI, reader compare mode.
- **Out:** running experiments; the CI integration (writing-terminal); AI drafting of replies.
- **Contracts touched:** [library-format.md](../../contracts/library-format.md) (`figures:`, `values:`, `check:` in `labshelf.yaml`; `.labshelf/versions/`, `.labshelf/rebuttal/`); [reader-host.md](../../contracts/reader-host.md) (compare mode).

## 4. Acceptance criteria

A1 and A2 pass in tests (A2 on a real pdflatex fixture); the run in a real extension host is open because the test host refuses modal dialogs. A5 is the work of the remaining session.

- [ ] **A1** Editing `plot_ablation.py` marks `fig/ablation.pdf` stale in the Writing view; "Regenerate" runs the command and clears the mark.
- [ ] **A2** `\lsvalue{results.acc}` builds to the number in `results.json`; hovering it shows the value and file.
- [x] **A3** The check flags a 10-page PDF against `check.pages: 9`, the author's name in the PDF metadata, and a Type 3 font.
- [x] **A4** After "Mark version: submitted" and some edits, "Compare" highlights the changed regions on each page.
- [ ] **A5** Pasted reviews become numbered points; marking all addressed and exporting writes a letter with quotes, replies and changed passages.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| provenance and staleness | `core/src/writing/figures/` + `node/` | mtime and content hash of inputs; the runner spawns the command in the project root |
| values | `core/src/writing/values/` | JSON path lookup; generated `labshelf-values.tex` with one `\csname` definition per value |
| checks | `core/src/writing/checks/` | PDF facts through pdf.js (page count, fonts, images, info dictionary) |
| versions and image diff | `core/src/writing/versions/`, `core/src/writing/compare/` + `core/src/reader/dom/` | the page diff runs in the extension host on pdf.js and native canvas renders; Compare opens two reader panels, each with `showChanges` |
| rebuttal | `core/src/writing/rebuttal/` | `.labshelf/rebuttal/<round>.json` |
| UI | `packages/vscode/src/writing/` | Writing view badges, commands, panels |

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | Rebuttal: review splitting, store, panel, export (A5) | yes |

The figures and numbers (S1–S3), the pre-submission check (S4–S6) and the versions (S7–S9) are finished and logged.

Runner tiers: **H** the session model (Opus or Fable); **M** Sonnet; **L** Haiku.

## 7. Risks

- **R1** Regenerate runs arbitrary commands. — One confirmation per project, commands only from `labshelf.yaml`, never from synced content without that confirmation on each machine.
- **R2** Image diff is noisy when text reflows. — Diff per page with a tolerance, and `latexdiff` for LaTeX when available.
- **R3** VS Code code that uses Node lands in the wrong folder and fails `lint:deps`. — Place it as [architecture.md#node-code-in-vs-code](../../architecture.md#node-code-in-vs-code) says: process and disk-path code in a feature's `node/` folder, registered through `writing/node/`; Node data reads through `ProjectDataPort`.

## 8. Log

See [log.md](log.md).
