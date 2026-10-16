# Plan: PDF preview chrome

Status: in progress (wave 1: sessions 1a and 1b of 8)
Size: GG — new preview surface, a labshelf.yaml contract change and new build features; 8 sessions in 4 waves (1a+1b, 2a+2b+2c, 3a+3b, 4 alone); grows if `\includeonly` needs a build wrapper beyond latexmk flags
Pending decisions: 0

## 1. Goal

The PDF preview beside a `.tex` or `.typ` source gets the layout of the mockup ([research/mockup.html](research/mockup.html), artifact https://claude.ai/artifact/R7WFcX1Qrw8fmw56RSA7sw): a thin header that acts (Build left, View right), the PDF on a grey desk that never dims, and a footer that reads like a status bar. Problems in the PDF, citations and limits become visible where the user reads, and build options stop hiding in commands.

## 2. Decisions

Facts: [research/preview.md](research/preview.md), [research/writing-core.md](research/writing-core.md), [research/ui-kit.md](research/ui-kit.md).

- [x] **D1** The chrome lives in core under `reader/dom/preview/` subfolders (header, footer, card), mounted only in preview mode; the library reader keeps its toolbar — browser editor (writing-4) reuses it later.
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

- [ ] **A1** The preview shows header (Recompile, options, logs, export | compare, mark, dark, find, sidebar, page nav, zoom), the desk and the footer at 13px chrome height ≤ 38px header / 26px footer; no `--ls-*`-less colour in new CSS (check-rules + vscodeHostCss test).
- [ ] **A2** Recompile is muted when current, full colour with an amber dot after a source save, spinning while building; the footer says Compiled N ago / Source changed / Compiling….
- [ ] **A3** Options menu toggles auto compile (setting respected on save for `.tex` and `.typ`) and switches the LaTeX engine; the change reaches labshelf.yaml.
- [ ] **A4** Ctrl/Cmd+S in the preview recompiles; double-click opens the source line (LaTeX).
- [ ] **A5** Logs button shows the warning+error count; its menu lists entries and opens the source line or the raw log.
- [ ] **A6** Footer breadcrumb shows file › section › subsection for the scrolled position; its menu jumps to a section.
- [ ] **A7** Footer shows `N cites · M to fix`; F8 / Shift+F8 and the arrows cycle problems, scroll to them and flash them; undefined cites have a red wavy underline, preprint entries amber, overfull lines a margin mark.
- [ ] **A8** Citation card shows authors · year, REF/BIB, title, venue · folder, `file:line · \cite…`, highlights on the cited page first then the rest folded, Open at p. N / Go to source.
- [ ] **A9** Card actions: Replace (undefined key), Update to <venue> (preprint), Add to library (bib-only) each edit the source or library and mark the PDF stale.
- [ ] **A10** Limit meter and popover read and write `check.pages`, `check.words`, `check.countUpTo`; words count across `\include`/`\input`.
- [ ] **A11** `N checks` runs Check Before Submitting; Compare Versions and Mark Version buttons run the existing commands.
- [ ] **A12** `<file> only` appears only in projects using `\include` and builds with `\includeonly`, keeping other chapters' numbering.
- [ ] **A13** Export menu saves a project zip and an arXiv zip with a trimmed `.bib`, and opens the PDF externally.
- [ ] **A14** Every theme in the VS Code host renders the chrome readably; the sheet stays brand (verify screenshots, light + dark).

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

**Parallel sessions.** Sessions sharing a number form a wave and run at the same time, in the same worktree, by separate agents; the letter tells them apart. A session with no letter runs alone. A wave starts when every session of the previous wave is committed.

| Wave | Runs together | Starts when |
|---|---|---|
| 1 | 1a, 1b | plan approved |
| 2 | 2a, 2b, 2c | 1a and 1b committed |
| 3 | 3a, 3b | 2a, 2b, 2c committed |
| 4 | 4 alone | 3a, 3b committed |

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1a | [sessions/1a-layout.md](sessions/1a-layout.md) | Header, desk, footer with existing features; icons, tokens, Dark PDF, breadcrumb; empty slots for later waves | yes |
| 1b | done (see log.md) | Protocol and contracts for all waves, `check.words`/`check.countUpTo` end to end, auto-compile setting, keymap entries, `buildPreviews.ts` split | yes |
| 2a | [sessions/2a-build.md](sessions/2a-build.md) | Host: stale state, options menu, auto compile, Ctrl+S, logs, Compare/Mark, problem list and limit counts sent to the webview | yes |
| 2b | [sessions/2b-footer.md](sessions/2b-footer.md) | Webview: PDF marks, F8, cites count, limit meter and popover, checks button | yes |
| 2c | [sessions/2c-citations.md](sessions/2c-citations.md) | Citation card, `[p.~N]`, key suggestion, Replace / Update / Add to library | yes |
| 3a | [sessions/3a-includeonly.md](sessions/3a-includeonly.md) | `\includeonly` spike and `<file> only` toggle | yes |
| 3b | [sessions/3b-export.md](sessions/3b-export.md) | Export menu: project zip, arXiv bundle, system viewer | yes |
| 4 | [sessions/4-verify.md](sessions/4-verify.md) | End-to-end verify against the mockup, docs, fixes, plan closed | yes |

Rules for sessions of one wave:

- Each session file lists the paths it **owns**. A session edits only its own paths; a change it needs elsewhere is reported to the main thread, not made.
- Protocol types, `documents/contracts/` and the keymap change only in 1b. Later waves implement them as written.
- Fields added to shared types are optional, so a sibling session's fixtures keep compiling.
- `documents/apps/vscode.md` changes only in 1a and 4; other sessions append their doc deltas to `log.md`.
- A gate failure in a sibling's owned files belongs to that sibling: report it, do not fix it.
- `commit-splitter` gets an explicit list of the session's own files (other sessions and plans share the worktree).

Every session: `test-writer` writes failing tests at the public seam first (AGENTS.md §6); UI sessions take light and dark screenshots with `verify`, compared with `research/mockup.html`; then `finish` and `commit-splitter`.

Runner tiers: **H** session model (design, algorithms, contracts); **M** Sonnet (specified implementation, tests); **L** Haiku (gates, commits).

## 7. Risks

- **R1** `reader/dom/preview/` already holds 8 files; `buildPreviews.ts` is near 200 lines — 1a splits the folder, 1b splits `buildPreviews.ts`, before wave 2 needs them.
- **R2** writing-2-submission-tools (rebuttal session) and typst-source-sync touch the reader-host preview messages — check `git worktree list` and their status before waves 1 and 2.
- **R3** Log classification of undefined citation / reference / overfull not verified — 1b reads `explainTexMessage.ts`, `readTexLog.ts` before fixing the problem kinds in the protocol.
- **R4** `\includeonly` with latexmk may break `.aux` reuse — 3a starts with a spike and a go/no-go.
- **R5** Verify needs the isolated extension host (memory: never the installed VS Code) — get approval before wave 1.
- **R6** Three agents in one worktree during wave 2 — owned paths are disjoint by construction; a needed change outside them goes back to the main thread.

## 8. Log

See [log.md](log.md).
