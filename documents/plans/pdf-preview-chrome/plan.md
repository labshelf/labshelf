# Plan: VS Code PDF preview redesign

Status: in progress (wave 1 committed; wave 2 next: sessions 2a–2i)
Size: GG — new preview surface, a labshelf.yaml contract change and new build features; 17 sessions in 4 waves (wave 2 nine wide); grows if `\includeonly` needs a build wrapper beyond latexmk flags
Pending decisions: 0

## 1. Goal

The PDF preview beside a `.tex` or `.typ` source gets the layout of the mockup ([research/mockup.html](research/mockup.html), artifact https://claude.ai/artifact/R7WFcX1Qrw8fmw56RSA7sw): a thin header that acts (Build left, View right), the PDF on a grey desk that never dims, and a footer that reads like a status bar. Problems in the PDF, citations and limits become visible where the user reads, and build options stop hiding in commands.

## 2. Decisions

Facts: [research/preview.md](research/preview.md), [research/writing-core.md](research/writing-core.md), [research/ui-kit.md](research/ui-kit.md).

- [x] **D1** The chrome lives in core under `reader/dom/preview/` subfolders (header, footer, card), mounted only in preview mode; the library reader keeps its toolbar — browser editor (writing-4) reuses them later.
- [x] **D2** Citation card highlights show their colour only, with no meaning label — no annotation format change (user choice).
- [x] **D3** Page and word limit, and "count up to References / End", live in `labshelf.yaml` `check:` next to the existing `pages` key, per project — syncs with coauthors (user choice; contract change).
- [x] **D4** Find and the sidebar toggle stay in the View group; the page-theme popover becomes one Dark PDF toggle (pdf.js `pageColors`); help leaves the header and stays on `?` (user choice).
- [x] **D5** The engine menu lists Tectonic, pdfLaTeX, XeLaTeX and LuaLaTeX for `.tex` roots and is hidden for `.typ` roots — Typst compiles in-process with typst.ts, so "Typst" is not an engine choice. It writes `engine` in labshelf.yaml through the existing pick-compiler path.
- [x] **D6** Auto compile is a VS Code setting `labshelf.writing.autoCompile` (default on) honoured by both save listeners and the Typst live compile — a per-user preference, not project data.
- [x] **D7** "Source changed" is host state: a project source saved or edited after the last successful build marks the root `stale` in `BuildState`; the PDF never dims.
- [x] **D8** F8 walks one ordered problem list per build: undefined citations, undefined references, overfull boxes, preprint entries. Placed on the PDF through SyncTeX for LaTeX; for Typst only citation problems are placed (typst cite targets), the rest open from the footer list.
- [x] **D9** Export writes through a save dialog: project `.zip`, arXiv bundle whose `.bib` holds only cited entries (built from the user's `.bib`, never `labshelf.bib`), and "Open PDF in system viewer".
- [x] **D10** The undefined-key suggestion ranks shelf cite keys by edit distance and author/year overlap in core; Replace edits the `\cite` in the source through a WorkspaceEdit.

## 3. Scope

- **In:** VS Code preview panel (LaTeX and Typst roots); core reader preview DOM, protocol and host ports; writing core for problems, suggestions, limits, export, `\includeonly`.
- **Out:** browser and terminal UIs (writing-4 adopts the core chrome later); highlight meanings; venue presets for limits; Typst SyncTeX (plan typst-source-sync).
- **Contracts touched:** `documents/contracts/reader-host.md#preview` (new messages), `documents/contracts/library-format.md#labshelfyaml` (`check.words`, `check.countUpTo`).

## 4. Acceptance criteria

- [ ] **A1** The preview shows header (Recompile, options, logs, export | compare, mark, dark, find, sidebar, page nav, zoom), the desk and the footer at 13px chrome height ≤ 38px header / 26px footer; no `--ls-*`-less colour in new CSS (check-rules + vscodeHostCss test). *(Layout part met and committed in wave 1.)*
- [ ] **A2** Recompile is muted when current, full colour with an amber dot after a source save, spinning while building; the footer says Compiled N ago / Source changed / Compiling….
- [ ] **A3** Options menu toggles auto compile (setting respected on save for `.tex` and `.typ`) and switches the LaTeX engine; the change reaches labshelf.yaml.
- [ ] **A4** Ctrl/Cmd+S in the preview recompiles; double-click opens the source line (LaTeX). *(Layout part met and committed in wave 1.)*
- [ ] **A5** Logs button shows the warning+error count; its menu lists entries and opens the source line or the raw log.
- [x] **A6** Footer breadcrumb shows file › section › subsection for the scrolled position; its menu jumps to a section.
- [ ] **A7** Footer shows `N cites · M to fix`; F8 / Shift+F8 and the arrows cycle problems, scroll to them and flash them; undefined cites have a red wavy underline, preprint entries amber, overfull lines a margin mark.
- [ ] **A8** Citation card shows authors · year, REF/BIB, title, venue · folder, `file:line · \cite…`, highlights on the cited page first then the rest folded, Open at p. N / Go to source.
- [ ] **A9** Card actions: Replace (undefined key), Update to <venue> (preprint), Add to library (bib-only) each edit the source or library and mark the PDF stale.
- [ ] **A10** Limit meter and popover read and write `check.pages`, `check.words`, `check.countUpTo`; words count across `\include`/`\input`.
- [ ] **A11** `N checks` runs Check Before Submitting; Compare Versions and Mark Version buttons run the existing commands.
- [ ] **A12** `<file> only` appears only in projects using `\include` and builds with `\includeonly`, keeping other chapters' numbering.
- [ ] **A13** Export menu saves a project zip and an arXiv zip with a trimmed `.bib`, and opens the PDF externally.
- [ ] **A14** Every theme in the VS Code host renders the chrome readably; the sheet stays brand (verify screenshots, light + dark). *(Layout part met and committed in wave 1.)*

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| Header, footer, menus, limit popover | `core/src/reader/dom/preview/{header,footer}/` | reuse `ui/dom/widgets/menu.ts`, `overlay.ts`, `toast.ts`, `statusPill` page/zoom logic; replaces `mountPreviewChrome` toolbar actions and `previewNotice` banner |
| New icons | `core/src/ui/icons/glyphs.ts` | git-compare, contrast, upload, log (lucide style) |
| Problem list + PDF marks | `core/src/writing/problems/` (pure) + `reader/dom/preview/marks/` | input: `BuildProblem[]`, bib findings, cite sites; output ordered `PreviewProblem` with page point |
| Card | extend `reader/dom/hover/citations/citationCard.ts` | adds source line, page-first highlights, fix actions |
| Key suggestion | `core/src/writing/citations/suggestKey.ts` | D10 |
| Bib-only → library | `core/src/writing/citations/` + `library/mutations` | import by DOI/arXiv if present, else from bib fields |
| Limit counting | reuse `countWords`, `collectProjectSources`, `paperBody` | D3 |
| `\includeonly` | `core/src/writing/latex/build/` | spike first: latexmk `-usepretex` vs generated wrapper root |
| Export | `core/src/writing/export/node/` | zip writer: check installed deps first (ladder) |
| Stale state, auto compile, Ctrl+S, engine | `packages/vscode/src/writing/{build,preview}/` | `buildPreviews.ts` is 195 lines: split before growing |
| Protocol, contracts, keymap | `core/src/reader/protocol.ts`, `previewProtocol.ts`, `logic/navigation/keymap.ts` | changed only in 1b, for every later wave; new fields optional |

## 6. Sessions

**Waves.** Wave 2 builds pieces in their own files, wave 3 wires them into the single-owner composition files, wave 4 verifies.

| Wave | Runs together | Starts when |
|---|---|---|
| 1 | 1a, 1b, 1c, 1d | plan approved |
| 2 | 2a–2i | wave 1 committed |
| 3 | 3a, 3b | wave 2 committed |
| 4 | 4a, 4b | wave 3 committed |

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1a | done (see log.md) | Header, desk, footer with existing features; icons, tokens, Dark PDF, breadcrumb; empty slots for later waves | yes |
| 1b | done (see log.md) | Protocol and contracts for all waves, `check.words`/`check.countUpTo` end to end, auto-compile setting, keymap entries, `buildPreviews.ts` split | yes |
| 1c | done (see log.md) | Dark PDF follows the init theme | — |
| 1d | done (see log.md) | Stale dot size, re-verify, finish | — |
| 1e | done (see log.md) | Gate and commit 1a + 1c + 1d | yes |

Owns abbreviated (`rd` core reader/dom, `cw` core writing, `vs` vscode writing).

| Session | File | Deliverable | Owns | Commit |
|---|---|---|---|---|
| 2a | [2a](sessions/2a-build-status.md) | Stale, `builtAt`, logs button | host controller, `vs/preview/{projectPreview,stale}`, `rd` header/logs | yes |
| 2b | [2b](sessions/2b-build-options.md) | Auto compile, engine, options menu | `vs/build/options`, save listeners, `rd` header/options | yes |
| 2c | [2c](sessions/2c-problems.md) | PDF problems, cites | `cw/problems`, `cw/index.ts`, `vs/preview/problems` | yes |
| 2d | [2d](sessions/2d-problem-marks.md) | Marks, cites status, F8 step | `rd` preview/marks, footer/cites | yes |
| 2e | [2e](sessions/2e-limits.md) | Words, limits, checks, meter | `cw/checks/limits`, `vs/preview/limits`, check cmd, `rd` footer/{limit,checks} | yes |
| 2f | [2f](sessions/2f-citation-card.md) | Card data and UI | `rd/hover/citations`, `citationKeys.ts`, `vs/preview/citations`, `reader.css` | yes |
| 2g | [2g](sessions/2g-citation-fixes.md) | `suggestKey`, card fixes | `cw/citations/fixes`, `vs/preview/citationFixes` | yes |
| 2h | [2h](sessions/2h-includeonly.md) | `\includeonly` | `cw/latex/build`, `vs/build/node/{latexBuilds,includeOnly}`, `rd` header/only | yes |
| 2i | [2i](sessions/2i-export.md) | Export (own worktree) | `cw/project/export`, `vs/export`, `package.json`, `rd` header/export | yes |
| 3a | [3a](sessions/3a-host-wiring.md) | Port handlers, roots fields | `vs/preview/{previewPorts.ts,projectPreview,roots}` | yes |
| 3b | [3b](sessions/3b-webview-wiring.md) | Slots, marks, keys | `mountPreviewChrome.ts`, barrels, `preview.css`, `rd/startup`, cheatsheet | yes |
| 4a | [4a](sessions/4a-webview-verify.md) | Headless webview check | core fixes | yes |
| 4b | [4b](sessions/4b-host-verify.md) | Host run, docs (worktree) | vscode fixes, `apps/vscode.md` | yes |

**Seams.** Messages: the 1b protocol, frozen. Full signatures in the owner's session file.

| Seam | File | Shape | Owner |
|---|---|---|---|
| S1 | `reader/host/hostController.ts` | `setBuildStatus(state, errors, { stale?, builtAt? })` | 2a |
| S3 | `rd/preview/header/<x>/` | `mount<X>(slot, { post })` → `{ setRoots(roots: PreviewRoots) }` | 2a 2b 2h 2i |
| S4 | `rd/preview/{marks,footer/*}/` | `mountProblemMarks`, `mountProblems` (`step(±1)`), `mountLimitMeter`, `mountChecksButton` | 2d 2e |
| S5 | `vs/preview/problems/` | `pdfProblemsOf` → `{ pdfProblems, cites }` | 2c |
| S6 | `vs/preview/limits/` | `rootWords`, `setCheckLimits`, `CheckCounts` | 2e |
| S7 | `vs/build/options/` | `buildOptions`, `setAutoCompile`, `setEngine`, `onAutoCompileChange` | 2b |
| S8 | `vs/build/node/includeOnly.ts` | `IncludeOnlyState.option`, `.set` | 2h |
| S9 | `vs/export/` | `exportProject(deps, project, root, target)` | 2i |
| S10 | `vs/preview/citationFixes/` | `withCitationFixes`, `fixCitation` | 2g |

**Parallel safety.** As in [TEMPLATE §6](../TEMPLATE/plan.md); only 1a and 4b edit `apps/vscode.md`.

## 7. Risks

- **R2** writing-2-submission-tools and typst-source-sync touch the preview messages — check `git worktree list` first.
- **R3** Problem kinds from the TeX log are unverified — 2c checks them first.
- **R4** `\includeonly` with latexmk may break `.aux` reuse — 2h starts with a spike and a go/no-go.
- **R5** Host verify only in a test-electron copy, never the installed VS Code — 4b confirms first.
- **R6** Nine sessions share a worktree in wave 2 — disjoint Owns, one owner per shared file; 2i and 4b use their own.
- **R7** A seam miss in wave 2 shows in wave 3 — the wiring session reports it.

## 8. Log

See [log.md](log.md).
