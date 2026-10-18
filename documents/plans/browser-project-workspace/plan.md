# Plan: the browser library page as a project workspace

Status: draft
Size: 14 sessions — spike, core moves, bridge, helper protocol, Tinymist, hardening, editor area, CodeMirror, LaTeX speed, lists, deletions, collaboration.

## 1. Goal

A browser-only user opens the LabShelf library page and writes a LaTeX or Typst project in the same tab, with the VS Code layout: sidebar with Library and Projects, centre tabs in up to two groups, a source editor with completion and problems, and a live PDF preview updated page by page. Builds run in LabShelf Helper, fast enough that the preview follows typing.

## 2. Decisions

- [ ] **D1** The library page (`packages/browser/src/library-page/`) is a project workspace that replicates the VS Code flow in [research/vscode-flow.md](research/vscode-flow.md): core sidebar (Library + Projects, "Explore templates" and "All projects" on, My projects with folders) and a centre editor area with tabs in up to two groups. Tabs: Library, All projects (open label "Open"), Templates, source files, PDF preview. Opening a project keeps the other tabs, opens the main source in the left group and the preview in the right group, switches the Projects section to the project row + Files / Outline / Checklist (By kind / By section) and collapses Library. Closing the project returns the list and closes that project's tabs. The URL hash restores the open tabs on reload, and `#/papers/...` keeps working.
- [ ] **D2** VS Code in the browser is removed: the monaco-vscode-api page, its build scripts and dependencies, the VS Code web build, `core/src/writing/helper/editorHost/`, `documents/contracts/editor-host.md` and `documents/plans/browser-editor/` (full list in session 13). The deletion runs after the replacement works.
- [ ] **D3** The editor is CodeMirror 6, loaded lazily. LaTeX: syntax, command and environment completion and `\begin` auto-close from `core/src/writing/latex/catalog` (`LATEX_COMMANDS`, `LATEX_ENVIRONMENTS`, `environmentToClose`), labels and refs, citation completion from `core/src/writing/citations`, compiler problems inline. Typst: Tinymist's completion, hover, diagnostics and go to definition through the helper (D4). Comments, history and versions as in VS Code; live collaboration through core `collab` and `y-codemirror.next`. Track changes is out of scope.
- [ ] **D4** Editing in the browser requires LabShelf Helper for both formats. The browser stops compiling Typst with typst.ts and stops downloading Typst fonts; the helper uses system fonts and resolves `@preview` packages natively. The helper is already standalone (`packages/terminal/src/helper/main.ts`, SEA binary and installers from plan browser-latex-helper); this plan adds a managed Tinymist binary, installed like the managed TeX (`documents/contracts/managed-tex.md`), which the helper runs for the browser and the VS Code extension runs as its own Typst language server, so VS Code no longer asks for the Tinymist extension.
- [ ] **D5** Transport between the extension and the helper:
  native messaging for discovery and handshake; a WebSocket on 127.0.0.1, random port, per-session token handed over native messaging, `Origin` checked against the extension origin (Firefox's per-install uuid learned over native messaging), binary frames; commands only on projects the extension opened, no arbitrary file read, no command execution; the helper reads project files from disk and the page sends edits; the helper returns only changed pages. Session 1 verifies Chrome's Local Network Access and Firefox behaviour for extension pages; if a browser blocks the socket, that browser uses native messaging only, with the same messages. `documents/contracts/helper.md` changes in session 5 (contract, tests first, `architecture-reviewer` after).
- [ ] **D6** Faster LaTeX in core's shared Node build (`core/src/writing/latex/build/`), so VS Code, the terminal app and the helper all gain: (a) a precompiled preamble format (`mylatexformat`, `.fmt`) rebuilt only when the preamble changes; (b) preview builds run one pass, the full build (bibliography, extra passes) runs on save or idle; (c) automatic `\includeonly` of the chapter being edited, other chapters' numbering kept from the last full build's `.aux`; (d) section preview: only section N compiled on the `.fmt` with the state of the last full build, only its pages swapped (detail in session 11). (a)–(c) land in session 3, (d) in session 11 with tests on state capture, restore and document assembly.
- [ ] **D7** The preview is the browser reader page in an iframe in preview mode (core reader `boot.preview`, reload keeps the position — [research/browser-runtime.md](research/browser-runtime.md)), updated page by page from the helper's changed pages.
- [ ] **D8** The options page chooses which sidebar sections show (Library, Projects); the code of a hidden section is not loaded.
- [ ] **D9** Performance budget on a mid-range laptop: each tab is a lazy chunk; scanners run debounced ~300 ms over the changed file off the hot path; saves debounced; the paper list and All projects lists are virtualized; closing a tab frees its editor or iframe. A headless Chrome check with 4x CPU throttle measures page open, editor ready to type and long tasks while typing (A9).
- [ ] **D10** Portable pieces that live only in `packages/vscode` move to core before the browser uses them ([research/core-reuse.md](research/core-reuse.md)): Files tree nodes, checklist sidebar nodes and rows, outline nesting and current heading, the portable All projects library, `createFile`, `toProjectRow`, the build summary over structural types, the gallery host and `useTemplate`. VS Code imports them from core. A core DOM editor area (tabs, two groups, sash; core tokens and icons) is new and goes through the `ui-design` skill. Browser templates: LabShelf Community and My templates over `LibraryFileSystem`; Typst Universe through the helper.
- [ ] **D11** No users and no real data exist: formats and protocol versions are replaced without migrations.

Other plans:

- **browser-editor**: superseded. Session 13 deletes it; its session 4 becomes session 14 here.
- **browser-latex-helper**: its session 7 (Firefox run, macOS screenshots) stays as is. Its D13 ("Typst compiles with typst.ts in the browser") and D3 ("the page owns the native port", now only for the handshake) are reversed by D4 and D5 here; `helper.md` changes in session 5 here.
- **browser-writing-companion**: its sessions that touch `library-page/` do not run alongside sessions 8–10 here.
- **project-collaboration**: session 14 starts after its sessions 2–5, 7 and 10 and meets its A12.

- [ ] **D12** The standalone helper also serves `app.labshelf.bridge` and reads project files from disk under the library root, so a helper-only user has an on-disk library; `native-host.md` changes with it (session 4, contract).
- [ ] **D13** `managed-tex.md` grows a Tinymist section and is renamed `managed-tools.md`; folder, lock and resolution rules are shared.
- [ ] **D14** The helper is hardened where it is not already (session 7 lists what exists): TeX without shell escape and with `openout_any`/`openin_any` = `p`, Tinymist confined to the project root, pinned download hashes, private file modes, redacted logs, signed Windows releases required, an uninstall that unregisters both hosts.

Open (blocks session 7):

- **Q1** macOS notarization needs a paid Developer ID, which browser-latex-helper D9 rejected — stay ad-hoc signed / buy the ID; recommendation: stay ad-hoc, the self-update keeps Gatekeeper to one step.

## 3. Acceptance

- [ ] **A1** The library page shows Library and Projects; "All projects", "Explore templates" and "All papers" each open a centre tab and earlier tabs stay selectable.
- [ ] **A2** Opening a project shows the main source on the left and the preview on the right, the Projects section shows Files / Outline / Checklist, Library collapses; closing it closes only that project's tabs.
- [ ] **A3** Reloading the page restores the open tabs; a `#/papers/...` link opens that paper.
- [ ] **A4** In a LaTeX file, typing `\beg` offers environments, accepting one closes it, `\cite{` offers library papers, `\ref{` offers labels, and a compile error shows on its line.
- [ ] **A5** In a Typst file, completion, hover, diagnostics and go to definition come from Tinymist through the helper; a `@preview` import compiles with no font or package download by the page.
- [ ] **A6** A socket without the token or from another origin is refused; no message reads outside an opened project (tests).
- [ ] **A7** After a one-word edit, the helper sends only the changed pages and the preview keeps its position.
- [ ] **A8** A second LaTeX preview build with an unchanged preamble reuses the `.fmt`; editing section N of a long document rebuilds only section N's pages with correct numbering (tests and a timed run).
- [ ] **A9** Headless Chrome with 4x CPU throttle: page open ≤ 1.5 s, editor ready to type ≤ 1.0 s after the tab opens, no long task > 50 ms while typing 200 characters.
- [ ] **A10** Hiding Projects in the options page removes the section and no project chunk loads.
- [ ] **A11** VS Code edits Typst with completion and diagnostics with no Tinymist extension installed.
- [ ] **A12** `packages/browser` has no `@codingame/*`, `tinymist-web` or typst.ts wasm; VS Code has no web build.
- [ ] **A13** Comments, history and versions work in the browser; a browser user joins a project shared from VS Code with cursors both ways.
- [ ] **A14** A template that writes outside its folder or calls `\write18` fails safely; a helper-only user opens a folder library (tests and a run).

## 4. Sessions

Owns, runners and briefs are in each session file.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-transport-spike.md](sessions/1-transport-spike.md) | socket answer per browser | plan `research/` | 2, 3 |
| 2 | [sessions/2-core-moves.md](sessions/2-core-moves.md) | portable vscode pieces in core | core `writing/` subfolders, vscode `writing/` | 1, 3 |
| 3 | [sessions/3-latex-speed.md](sessions/3-latex-speed.md) | `.fmt`, one-pass preview, `\includeonly` | core `latex/build/` | 1, 2 |
| 4 | [sessions/4-standalone-bridge.md](sessions/4-standalone-bridge.md) | helper serves the bridge | `native-host.md`, terminal helper, SEA, installers | alone |
| 5 | [sessions/5-helper-socket.md](sessions/5-helper-socket.md) | helper.md v2, socket, client | `helper.md`, core `helper/`, browser `helper/client/` | alone |
| 6 | [sessions/6-managed-tinymist.md](sessions/6-managed-tinymist.md) | managed Tinymist, LSP relay, VS Code server | core `typst/toolchain/`, `managed-tools.md`, vscode `typst/` | alone |
| 7 | [sessions/7-security.md](sessions/7-security.md) | helper hardening | see file | alone |
| 8 | [sessions/8-workspace-shell.md](sessions/8-workspace-shell.md) | editor area, tabs, hash, sidebar | core `editorArea/`, browser `library-page/`, `options/` | alone |
| 9 | [sessions/9-codemirror-latex.md](sessions/9-codemirror-latex.md) | CodeMirror, LaTeX, preview | `library-page/{editor,preview}/`, browser deps | alone |
| 10 | [sessions/10-typst-panes.md](sessions/10-typst-panes.md) | Typst LSP, comments, history | `library-page/{editor/typst,review}/` | 11, 12 |
| 11 | [sessions/11-section-preview.md](sessions/11-section-preview.md) | LaTeX section preview | core `latex/build/section/` | 10, 12 |
| 12 | [sessions/12-list-virtualization.md](sessions/12-list-virtualization.md) | virtualized lists | core `library-ui/dom/list/`, `allProjects/dom/` | 10, 11 |
| 13 | [sessions/13-delete-perf.md](sessions/13-delete-perf.md) | removals, perf check | D2 paths, build scripts, lockfile | alone |
| 14 | [sessions/14-collaboration.md](sessions/14-collaboration.md) | collaboration on CodeMirror | `editor/collab/`, collab deps | alone |

Order: 1 + 2 + 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 + 11 + 12 → 13 → 14.
