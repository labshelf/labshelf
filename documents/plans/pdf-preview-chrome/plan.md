# Plan: VS Code PDF preview redesign

Status: in progress
Size: 7 sessions — remaining host and webview pieces, their wiring, and the final checks of a larger redesign

## 1. Goal

The PDF preview beside a `.tex` or `.typ` source gets the layout of the mockup ([research/mockup.html](research/mockup.html), artifact https://claude.ai/artifact/R7WFcX1Qrw8fmw56RSA7sw): a thin header that acts (Build left, View right), the PDF on a grey desk that never dims, and a footer that reads like a status bar. Problems in the PDF, citations and limits become visible where the user reads, and build options stop hiding in commands.

## 2. Decisions

Facts: [research/preview.md](research/preview.md), [research/writing-core.md](research/writing-core.md), [research/ui-kit.md](research/ui-kit.md).

- [x] **D1** The chrome lives in core under `reader/dom/preview/` subfolders (header, footer, card, marks), mounted only in preview mode; the library reader keeps its toolbar — the browser editor (writing-4) reuses them later.
- [x] **D2** Citation card highlights show their colour only, with no meaning label — no annotation format change (user choice).
- [x] **D3** Page and word limit, and "count up to References / End", live in `labshelf.yaml` `check:` next to the existing `pages` key, per project — syncs with coauthors (user choice; contract change in `documents/contracts/library-format.md#labshelfyaml`: `check.words`, `check.countUpTo`).
- [x] **D4** Find and the sidebar toggle stay in the View group; the page-theme popover becomes one Dark PDF toggle (pdf.js `pageColors`); help leaves the header and stays on `?` (user choice).
- [x] **D5** The engine menu lists Tectonic, pdfLaTeX, XeLaTeX and LuaLaTeX for `.tex` roots and is hidden for `.typ` roots — Typst compiles in-process with typst.ts, so "Typst" is not an engine choice. It writes `engine` in labshelf.yaml through the existing pick-compiler path.
- [x] **D6** Auto compile is a VS Code setting `labshelf.writing.autoCompile` (default on) honoured by both save listeners and the Typst live compile — a per-user preference, not project data.
- [x] **D7** "Source changed" is host state: a project source saved or edited after the last successful build marks the root `stale` in `BuildState`; the PDF never dims.
- [x] **D8** F8 walks one ordered problem list per build: undefined citations, undefined references, overfull boxes, preprint entries. Placed on the PDF through SyncTeX for LaTeX; for Typst only citation problems are placed (typst cite targets), the rest open from the footer list.
- [x] **D9** Export writes through a save dialog: project `.zip`, arXiv bundle whose `.bib` holds only cited entries (built from the user's `.bib`, never `labshelf.bib`), and "Open PDF in system viewer".
- [x] **D10** The undefined-key suggestion ranks shelf cite keys by edit distance and author/year overlap in core; Replace edits the `\cite` in the source through a WorkspaceEdit.
- [x] **D11** Placement: header, footer, menus and limit popover in `core/src/reader/dom/preview/{header,footer}/`; problem list in `core/src/writing/problems/` with PDF marks in `reader/dom/preview/marks/`; key suggestion in `core/src/writing/citations/`; `\includeonly` in `core/src/writing/latex/build/`; export in `core/src/writing/project/export`; stale state, auto compile, Ctrl+S and engine in `packages/vscode/src/writing/{build,preview}/`. Protocol messages (`core/src/reader/protocol.ts`, `previewProtocol.ts`, `previewRequests.ts`, contract `documents/contracts/reader-host.md#preview`) are frozen.
- [x] **D12** Out of scope: browser and terminal UIs (writing-4 adopts the core chrome later), highlight meanings, venue presets for limits, Typst SyncTeX (plan typst-source-sync).

Open: none.

Cross-plan caveat: writing-2-submission-tools and typst-source-sync also touch the preview messages; run `git worktree list` before a session that edits them.

## 3. Acceptance

- [ ] **A1** The preview shows header (Recompile, options, logs, export | compare, mark, dark, find, sidebar, page nav, zoom), the desk and the footer at 13px chrome height ≤ 38px header / 26px footer; no `--ls-*`-less colour in new CSS (check-rules + vscodeHostCss test). *(Layout part met and committed.)*
- [ ] **A2** Recompile is muted when current, full colour with an amber dot after a source save, spinning while building; the footer says Compiled N ago / Source changed / Compiling….
- [ ] **A3** Options menu toggles auto compile (setting respected on save for `.tex` and `.typ`) and switches the LaTeX engine; the change reaches labshelf.yaml.
- [ ] **A4** Ctrl/Cmd+S in the preview recompiles; double-click opens the source line (LaTeX). *(Layout part met and committed.)*
- [ ] **A5** Logs button shows the warning+error count; its menu lists entries and opens the source line or the raw log.
- [x] **A6** Footer breadcrumb shows file › section › subsection for the scrolled position; its menu jumps to a section.
- [ ] **A7** Footer shows `N cites · M to fix`; F8 / Shift+F8 and the arrows cycle problems, scroll to them and flash them; undefined cites have a red wavy underline, preprint entries amber, overfull lines a margin mark.
- [ ] **A8** Citation card shows authors · year, REF/BIB, title, venue · folder, `file:line · \cite…`, highlights on the cited page first then the rest folded, Open at p. N / Go to source.
- [ ] **A9** Card actions: Replace (undefined key), Update to <venue> (preprint), Add to library (bib-only) each edit the source or library and mark the PDF stale.
- [ ] **A10** Limit meter and popover read and write `check.pages`, `check.words`, `check.countUpTo`; words count across `\include`/`\input`.
- [ ] **A11** `N checks` runs Check Before Submitting; Compare Versions and Mark Version buttons run the existing commands.
- [ ] **A12** `<file> only` appears only in projects using `\include` and builds with `\includeonly`, keeping other chapters' numbering.
- [ ] **A13** Export menu saves a project zip and an arXiv zip with a trimmed `.bib`, and opens the PDF externally.
- [ ] **A14** Every theme in the VS Code host renders the chrome readably; the sheet stays brand (verify screenshots, light + dark). *(Layout part met and committed.)*

## 4. Sessions

Seams between sessions (signatures in the owner's session file): S5 `pdfProblemsOf`, S6 `rootWords`/`setCheckLimits`/`CheckCounts`, S7 `buildOptions`/`setAutoCompile`/`setEngine`/`onAutoCompileChange`, S8 `IncludeOnlyState`, S9 `exportProject`, S10 `withCitationFixes`/`fixCitation`.

Paths abbreviated: `rd` = `packages/core/src/reader/dom`, `cw` = `packages/core/src/writing`, `vs` = `packages/vscode/src/writing`.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 2g | [sessions/2g-citation-fixes.md](sessions/2g-citation-fixes.md) | `suggestKey`, card fixes (Replace, Update, Add) | `cw/citations/fixes/`, `cw/citations/index.ts`, `vs/preview/citationFixes/` | 2h, 2j |
| 2h | [sessions/2h-includeonly.md](sessions/2h-includeonly.md) | `\includeonly` build and `<file> only` toggle | `cw/latex/build/**`, `vs/build/node/{latexBuilds,includeOnly,index}.ts`, `rd/preview/header/only/` | 2g, 2j |
| 2j | [sessions/2j-build-status-finish.md](sessions/2j-build-status-finish.md) | Gate and commit of the stale and logs-button work | `core/src/reader/host/hostController.ts`, `vs/preview/projectPreview/**`, `vs/preview/stale/`, `rd/preview/header/logs/`, `rd/styles/preview-logs-button.css` | 2g, 2h |
| 3a | [sessions/3a-host-wiring.md](sessions/3a-host-wiring.md) | Port handlers, roots fields | `vs/preview/{previewPorts.ts,index.ts}`, `vs/preview/projectPreview/**`, `vs/preview/roots/**` | 3b |
| 3b | [sessions/3b-webview-wiring.md](sessions/3b-webview-wiring.md) | Slots, marks, keys | `rd/preview/{mountPreviewChrome.ts,index.ts}`, `rd/preview/header/index.ts`, `rd/preview/footer/{index.ts,pageChip.ts}`, `rd/styles/preview.css`, `rd/startup/{readerActions,buildReaderUi,hostMessages}.ts`, `rd/chrome/cheatsheet.ts` | 3a |
| 4a | [sessions/4a-webview-verify.md](sessions/4a-webview-verify.md) | Headless webview check and fixes | fixes in `packages/core/src/reader/**` and `packages/core/src/ui/**`, `.verify/preview-4a/` | 4b |
| 4b | [sessions/4b-host-verify.md](sessions/4b-host-verify.md) | Extension-host run, docs (own worktree) | fixes in `packages/vscode/**`, `documents/apps/vscode.md`, `documents/contracts/reader-host.md` | 4a |

Order: 2g, 2h, 2j run together first; 3a and 3b run after them; 4a and 4b run last. 3a and 2j both edit `projectPreview/**`, so 3a starts only after 2j is committed.
