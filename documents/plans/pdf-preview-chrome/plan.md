# Plan: VS Code PDF preview redesign

Status: in progress
Size: 1 session — the extension-host check of a redesign whose code is in place

## 1. Goal

The PDF preview beside a `.tex` or `.typ` source gets the layout of the mockup ([research/mockup.html](research/mockup.html), artifact https://claude.ai/artifact/R7WFcX1Qrw8fmw56RSA7sw): a thin header that acts (Build left, View right), the PDF on a grey desk that never dims, and a footer that reads like a status bar. Problems in the PDF, citations and limits become visible where the user reads, and build options stop hiding in commands.

## 2. Decisions

Facts: [research/preview.md](research/preview.md), [research/writing-core.md](research/writing-core.md), [research/ui-kit.md](research/ui-kit.md).

- [x] **D1** The chrome lives in core under `reader/dom/preview/` subfolders (header, footer, card, marks), mounted only in preview mode; the library reader keeps its toolbar — the browser editor (browser-editor) reuses them later.
- [x] **D2** Citation card highlights show their colour only, with no meaning label — no annotation format change (user choice).
- [x] **D3** Page and word limit, and "count up to References / End", live in `labshelf.yaml` `check:` next to the existing `pages` key, per project — syncs with coauthors (user choice; contract change in `documents/contracts/library-format.md#labshelfyaml`: `check.words`, `check.countUpTo`).
- [x] **D4** The View group holds Compare, Mark, Dark PDF, page arrows with a page box, and zoom (− + and a % menu). Find stays on Ctrl/Cmd+F and the sidebar leaves the header; help stays on `?` (user choice, target screenshots of 2026-10-17). Dark PDF is a local toggle, off by default: sheets stay light paper on every VS Code theme.
- [x] **D5** The engine menu lists Tectonic, pdfLaTeX, XeLaTeX and LuaLaTeX for `.tex` roots and is hidden for `.typ` roots — Typst compiles in-process with typst.ts, so "Typst" is not an engine choice. It writes `engine` in labshelf.yaml through the existing pick-compiler path.
- [x] **D6** Auto compile is a VS Code setting `labshelf.writing.autoCompile` (default on) honoured by both save listeners and the Typst live compile — a per-user preference, not project data.
- [x] **D7** "Source changed" is host state: a project source saved or edited after the last successful build marks the root `stale` in `BuildState`; the PDF never dims.
- [x] **D8** F8 walks one ordered problem list per build: undefined citations, undefined references, overfull boxes, preprint entries. Placed on the PDF through SyncTeX for LaTeX; for Typst only citation problems are placed (typst cite targets), the rest open from the footer list.
- [x] **D9** Export writes through a save dialog: project `.zip`, arXiv bundle whose `.bib` holds only cited entries (built from the user's `.bib`, never `labshelf.bib`), and "Open PDF in system viewer".
- [x] **D10** The undefined-key suggestion ranks shelf cite keys by edit distance and author/year overlap in core; Replace edits the `\cite` in the source through a WorkspaceEdit.
- [x] **D11** Placement: header, footer, menus and limit popover in `core/src/reader/dom/preview/{header,footer}/`; problem list in `core/src/writing/problems/` with PDF marks in `reader/dom/preview/marks/`; key suggestion in `core/src/writing/citations/`; `\includeonly` in `core/src/writing/latex/build/`; export in `core/src/writing/project/export`; stale state, auto compile, Ctrl+S and engine in `packages/vscode/src/writing/{build,preview}/`. Protocol messages (`core/src/reader/protocol.ts`, `previewProtocol.ts`, `previewRequests.ts`, contract `documents/contracts/reader-host.md#preview`) are frozen.
- [x] **D12** Out of scope: browser and terminal UIs (browser-editor adopts the core chrome later), highlight meanings, venue presets for limits.

Open: none.

Cross-plan caveat: writing-2-submission-tools also touches the preview messages; run `git worktree list` before a session that edits them.

## 3. Acceptance

Checked headless on fixture messages (dark, light, 420 px) unless marked; the host half of each is session 4b.

- [x] **A1** The preview shows header (Recompile, options, `only`, logs, export | compare, mark, dark, page nav, zoom), the desk and the footer at ≤ 38px header / 26px footer; no `--ls-*`-less colour in the preview CSS.
- [ ] **A2** Recompile is muted when current, full colour with an amber dot after a source save, spinning while building; the footer says Compiled N ago / Source changed / Compiling…. *(Webview states seen; host save path is 4b.)*
- [ ] **A3** Options menu toggles auto compile (setting respected on save for `.tex` and `.typ`) and switches the LaTeX engine; the change reaches labshelf.yaml. *(Menu seen; host is 4b.)*
- [ ] **A4** Ctrl/Cmd+S in the preview recompiles; double-click opens the source line (LaTeX). *(Keys wired and tested; host is 4b.)*
- [ ] **A5** Logs button shows the warning+error count; its menu lists entries and opens the source line or the raw log. *(Count seen; menu actions are 4b.)*
- [x] **A6** Footer breadcrumb shows file › section › subsection for the scrolled position; its menu jumps to a section.
- [ ] **A7** Footer shows `N cites · M to fix`; F8 / Shift+F8 and the arrows cycle problems, scroll to them and flash them; undefined cites have a red wavy underline, preprint entries amber, overfull lines a margin mark. *(Footer and red underline seen; F8 on a real build is 4b.)*
- [x] **A8** Citation card shows authors · year, REF/BIB, title, venue · folder, `file:line · \cite…`, highlights on the cited page first then the rest folded, Open at p. N / Go to source.
- [ ] **A9** Card actions: Replace (undefined key), Update to <venue> (preprint), Add to library (bib-only) each edit the source or library and mark the PDF stale. *(Host tests pass; real library is 4b.)*
- [ ] **A10** Limit meter and popover read and write `check.pages`, `check.words`, `check.countUpTo`; words count across `\include`/`\input`. *(Popover seen; write to labshelf.yaml is 4b.)*
- [ ] **A11** `N checks` runs Check Before Submitting; Compare Versions and Mark Version buttons run the existing commands.
- [ ] **A12** `<file> only` appears only in projects using `\include` and builds with `\includeonly`, keeping other chapters' numbering. *(latexmk spike passed; host is 4b; Tectonic hides the toggle, unverified.)*
- [ ] **A13** Export menu saves a project zip and an arXiv zip with a trimmed `.bib`, and opens the PDF externally.
- [ ] **A14** Every theme in the VS Code host renders the chrome readably; the sheet stays brand. *(Dark and light Modern seen headless.)*

## 4. Sessions

| Session | File | Deliverable | Owns |
|---|---|---|---|
| 4b | [sessions/4b-host-verify.md](sessions/4b-host-verify.md) | Extension-host run, fixes, docs | fixes in `packages/vscode/**` and `packages/core/src/reader/**`, `documents/apps/vscode.md`, `documents/contracts/reader-host.md` |

Known gaps for 4b: a build with `\includeonly` overwrites `<main>.pdf` next to the source until the forced full build that follows; highlight meaning labels ("Key claim") are not in the protocol, so the card shows the colour only (D2).
