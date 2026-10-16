# Plan: submission tools

Status: draft
Size: GG — five features in core and VS Code, one of them a visual PDF diff; 4 sessions.
Pending decisions: 1

## 1. Goal

LabShelf carries a paper from the experiments to the camera-ready: figures and numbers stay in step with the code that produces them, a check before submitting catches desk-reject mistakes, every submitted version is kept and comparable, and the rebuttal is organised comment by comment.

Builds on [writing-core.plan.md](../../archive/writing-core.plan.md). The terminal and CI side is in [writing-terminal.plan.md](3-writing-terminal.plan.md).

## 2. Decisions

- [ ] **D1** Figure provenance: `labshelf.yaml` maps each figure to the command that makes it and its inputs (`figures: {fig/ablation.pdf: {run: python plot_ablation.py, inputs: [plot_ablation.py, results/*.json]}}`). LabShelf marks a figure stale when an input is newer than it, and "Regenerate" runs the command (desktop only). — Only a tool that lives with the code can do this.
- [ ] **D2** Live numbers: LaTeX projects get `\lsvalue{<file>.<path>}`, backed by a generated `labshelf-values.tex` built from the JSON files listed in `labshelf.yaml`; Typst reads JSON natively, so LabShelf only adds hover and completion over the same files. Hover shows the value and its source. — No number is copied by hand.
- [ ] **D3** Pre-submission check, one command, results in Problems: page limit (from `labshelf.yaml` `check.pages`), anonymity (author names from `labshelf.yaml`, the git user and the PDF info dictionary; phrases like "our previous work"; GitHub or personal URLs), Type 3 fonts, raster figures under 300 dpi, unresolved references and citations. — Each item is a known desk-reject cause.
- [ ] **D4** Versions: "Mark version" (submitted, rebuttal, camera-ready, or a free name) snapshots the sources and the PDF into `.labshelf/versions/<name>/`, synced with the project. "Compare" opens two versions side by side in the reader with changed regions highlighted from a page-image diff; `latexdiff` is used when TeX Live has it. — Works for both formats with one mechanism.
- [ ] **D5** Rebuttal panel: paste the reviews; LabShelf splits them into numbered points (editable), each a thread with status (open, addressed, won't fix) linked to source ranges through the comments of [writing-sync](2-writing-sync.plan.md); "Export response" writes a Markdown or LaTeX letter quoting each point, the reply and the changed passages from the version diff. — The rebuttal is tracked, not juggled.

Open (blocks approval):

- **Q1** Venue presets for the check (page limits, anonymity rules) — options: none, the user sets `check:` / ship presets for a few venues (NeurIPS, ICML, ACL, IEEE); recommendation: no presets, because limits change every year and a wrong preset is worse than none.

## 3. Scope

- **In:** core `writing/` (provenance, values, checks, versions, rebuttal), VS Code UI, reader compare mode.
- **Out:** running experiments; the CI integration (writing-terminal); AI drafting of replies.
- **Contracts touched:** [library-format.md](../../contracts/library-format.md) (`figures:`, `values:`, `check:` in `labshelf.yaml`; `.labshelf/versions/`, `.labshelf/rebuttal/`); [reader-host.md](../../contracts/reader-host.md) (compare mode).

## 4. Acceptance criteria

- [ ] **A1** Editing `plot_ablation.py` marks `fig/ablation.pdf` stale in the Writing view; "Regenerate" runs the command and clears the mark.
- [ ] **A2** `\lsvalue{results.acc}` builds to the number in `results.json`; hovering it shows the value and file.
- [ ] **A3** The check flags a 10-page PDF against `check.pages: 9`, the author's name in the PDF metadata, and a Type 3 font.
- [ ] **A4** After "Mark version: submitted" and some edits, "Compare" highlights the changed regions on each page.
- [ ] **A5** Pasted reviews become numbered points; marking all addressed and exporting writes a letter with quotes, replies and changed passages.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| provenance and staleness | `core/src/writing/figures/` + `node/` | mtime and content hash of inputs; the runner spawns the command in the project root |
| values | `core/src/writing/values/` | JSON path lookup; generated `labshelf-values.tex` with one `\csname` definition per value |
| checks | `core/src/writing/checks/` | PDF facts through pdf.js (page count, fonts, images, info dictionary) |
| versions and image diff | `core/src/writing/versions/` + `core/src/reader/dom/` | page rendering through the reader, diff in a worker |
| rebuttal | `core/src/writing/rebuttal/` | `.labshelf/rebuttal/<round>.json` |
| UI | `packages/vscode/src/writing/` | Writing view badges, commands, panels |

## 6. Sessions and steps

### Session 1 — figures and numbers

- **Starts from:** writing-core done; clean tree.
- **Ends with:** A1, A2
- **Commit:** yes, one per step

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | Figure provenance, staleness and regenerate | — | M · implementer (sonnet) | A1 | [ ] |
| S2 | Values file, macro and hover | — | M · implementer (sonnet) | A2 | [ ] |
| S3 | Finish | S1–S2 | `finish` skill | gate passes | [ ] |

### Session 2 — pre-submission check

- **Starts from:** session 1 committed; Q1 answered
- **Ends with:** A3
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S4 | Check rules over the PDF and the sources | — | H · main thread | core tests on fixture PDFs | [ ] |
| S5 | Command and Problems output | S4 | M · implementer (sonnet) | A3 | [ ] |
| S6 | Finish | S4–S5 | `finish` skill | gate passes | [ ] |

### Session 3 — versions

- **Starts from:** session 2 committed
- **Ends with:** A4
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S7 | Snapshots | — | M · implementer (sonnet) | snapshot synced | [ ] |
| S8 | Page-image diff and reader compare mode; `latexdiff` when present | S7 | H · main thread | A4 | [ ] |
| S9 | Finish, plus a `verify` run | S7–S8 | `finish` + `verify` skills | gate passes | [ ] |

### Session 4 — rebuttal

- **Starts from:** session 3 committed
- **Ends with:** A5
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S10 | Review splitting and rebuttal store | — | H · main thread | core tests on real review texts | [ ] |
| S11 | Panel, links to comments, export | S10, S8 | M · implementer (sonnet) | A5 | [ ] |
| S12 | Finish | S10–S11 | `finish` skill | gate passes | [ ] |

### Step blocks

#### S1 — Figures

- **Do:** read `figures:`; compute staleness from input globs; badge stale figures in the Writing view and the reader; "Regenerate" runs the command with output to an output channel and a log entry on failure.
- **Context:** commands run only after the user confirms once per project (they execute code).

#### S2 — Values

- **Do:** read `values:` (list of JSON files); generate `labshelf-values.tex` on build; `\lsvalue{file.path}` completion and hover in LaTeX; hover and completion over `json("…")` paths in Typst.

#### S4 — Check rules

- **Do:** each rule returns findings with a location (page, or file and line); pdf.js gives page count, font types, image sizes and the info dictionary; sources give names, phrases and URLs.

#### S8 — Compare

- **Do:** render both PDFs page by page, diff the images in a worker, draw changed regions in a two-up reader view; when `latexdiff` exists, offer the marked-up PDF instead.

#### S10–S11 — Rebuttal

- **Do:** split pasted text on numbered or bulleted points per reviewer; store points with status and linked comment threads; export with the changed passages from the latest version comparison.

## 7. Risks

- **R1** Regenerate runs arbitrary commands. — One confirmation per project, commands only from `labshelf.yaml`, never from synced content without that confirmation on each machine.
- **R2** Image diff is noisy when text reflows. — Diff per page with a tolerance, and `latexdiff` for LaTeX when available.

## 8. Log
