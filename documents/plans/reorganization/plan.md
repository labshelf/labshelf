# Plan: Reorganize core, vscode and browser into cohesive modules

Status: approved
Size: 41 sessions — slices S1–S22 of analysis/reorganization.md §7 (S0 done by hand), big slices split a/b/c

## 1. Goal

Turn the fragmented code (55% of files under 40 lines, 385 barrels, private helpers copied across files and apps) into one module per concept: shared helpers in `core/<subject>`, domains merged into concept files of up to 400 lines, apps holding only wiring and platform code. Each session rewrites code into the target, merges duplicates into one canonical version and deletes the old code; it never just moves files.

## 2. Decisions

- [x] **D0** The rules (S0) are done: `documents/code.md`, `pnpm lint:modules` with its ratchet baseline, `pnpm lint:rules` with the 400-line limit. `analysis/reorganization.md` §6 and the R-* labels of §7 are superseded.
- [x] **D1** Reorganizing means rewriting into the target: merge, re-point every caller, delete old code, files and barrels in the same session; no compatibility re-exports.
- [x] **D2** Duplicate versions that behave differently: follow the canonical behaviour or bug call of `analysis/reorganization.md` §3 and pin it with a test; otherwise keep each caller's behaviour through an option or a second function.
- [x] **D3** Typing is limited to `LibraryPath` and `ProjectPath` (session 1) and `Doi` (session 11b). Other brands from `analysis/typing.md` are out of scope.
- [x] **D4** No other behaviour change; protocols, on-disk formats and contract texts stay as they are unless a session says otherwise.
- [x] **D5** Sessions run one at a time, in order, on branch `refactor/reorganization`, unattended through `pnpm plan:run documents/plans/reorganization` (`scripts/plans/runPlan.mjs`): one fresh headless Claude process per session, stopping at the first failure, uncommitted change or session without a commit.
- [x] **D6** Every session starts by rebuilding `analysis/labshelf.db` (`sh analysis/scripts/run.sh`) and writing its current sites to `research/<id>.md`; package briefs live in `research/<id>.<n>.md` because session files are limited to 6,000 characters.
- [x] **D7** Each session shrinks, never grows, `scripts/lint/modulesBaseline.json` and `scripts/lint/duplicatesBaseline.json`; each new shared module joins `SHARED_MODULES` in `scripts/lint/modules.mjs` and the "Shared modules" list in `documents/code.md`.

## 3. Acceptance

- [ ] **A1** `pnpm gate` passes after every session (typecheck, tests, lint for core, vscode, browser and terminal).
- [ ] **A2** `scripts/lint/modulesBaseline.json` and `duplicatesBaseline.json` are smaller at the end than at plan start (689 module violations).
- [ ] **A3** The duplicate families of `analysis/reorganization.md` §3 marked for merging have one canonical version; `node analysis/scripts/validate.mjs` shows no T1/T2 family among them.
- [ ] **A4** No helper of a shared module is re-declared privately (`pnpm lint:modules` rule `shared-name`).
- [ ] **A5** App code that §2.2/§2.3 marks as belonging in core lives in core, and no app holds a copy of core code (sessions 22a, 22b).

## 4. Sessions

All run alone, in this order; each starts from the previous one committed. Owns are listed in each session file.

| Session | Deliverable |
|---|---|
| 1 | `core/path`: PathOps move, nodePathOps, string helpers, `LibraryPath`/`ProjectPath` |
| 2 | `core/path` `isInside` for all 12 sites |
| 3 | `core/url` |
| 4 | `core/guards`, `core/json` |
| 5 | `core/time`, `core/async` |
| 6 | `core/errors` |
| 7 | `core/encoding`, `core/hash` finished in place |
| 8 | `core/events` |
| 9 | `core/text`, `core/files/node`, `readStable` |
| 10 | core `ui`, `model`, `ports`, `logging` |
| 11a, 11b, 11c | core `import`: pdfFinder; registries + metadata + `Doi`; pdf, landing, paper, bibtex, search, node |
| 12a, 12b, 12c | core `latex` toolchain/biber; source/build; `typst` + latex catalog/log/hover |
| 13a, 13b, 13c | core `library`: layout/record/search; mutations/node; conflicts + writing/conflict |
| 14a, 14b, 14c | core `writing`: project/service/build; citations/checks/history; search/synctex/snippet/figures/outline/text |
| 15a, 15b | core `writing/allProjects` + `spaces`; `templates` + one path comparator |
| 16a, 16b | core `reader`; `libraryUi` + sharing flows into `share` |
| 17a, 17b, 17c | core `collab` doc/mirror/invite/peer/dom; relays/session/node + `relay`; `share` |
| 18a, 18b | core `helper` + `bridge`; `nativeHost`, `ai`, `qmd` |
| 19a, 19b, 19c | vscode `writing`: shared helpers/build/typst/figures/history; preview; commands/citations/projects/search/templates |
| 20a, 20b | vscode library/latex/webview plumbing; libraryUi/spaces/reader/relay/share/collab |
| 21a, 21b, 21c | browser platform + libraryUi; storage/collab/helper/relay; writing + entry surfaces |
| 22a, 22b | app code that belongs in core moved, app copies deleted; 22b also runs `finish plan` and deletes this directory |
