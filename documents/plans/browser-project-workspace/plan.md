# Plan: the browser library page as a project workspace

Status: draft
Size: 11 sessions — spike, core moves, helper protocol, managed Tinymist, editor area, CodeMirror, two LaTeX speed steps, deletions, collaboration.

## 1. Goal

A browser-only user opens the LabShelf library page and writes a LaTeX or Typst project in the same tab, with the VS Code layout: sidebar with Library and Projects, centre tabs in up to two groups, a source editor with completion and problems, and a live PDF preview updated page by page. Builds run in LabShelf Helper, fast enough that the preview follows typing.

## 2. Decisions

- [ ] **D1** The library page (`packages/browser/src/library-page/`) is a project workspace that replicates the VS Code flow in [research/vscode-flow.md](research/vscode-flow.md): core sidebar (Library + Projects, "Explore templates" and "All projects" on, My projects with folders) and a centre editor area with tabs in up to two groups. Tabs: Library, All projects (open label "Open"), Templates, source files, PDF preview. Opening a project keeps the other tabs, opens the main source in the left group and the preview in the right group, switches the Projects section to the project row + Files / Outline / Checklist (By kind / By section) and collapses Library. Closing the project returns the list and closes that project's tabs. The URL hash restores the open tabs on reload, and `#/papers/...` keeps working.
- [ ] **D2** VS Code in the browser is removed: the monaco-vscode-api page, its build scripts and dependencies, the VS Code web build, `core/src/writing/helper/editorHost/`, `documents/contracts/editor-host.md` and `documents/plans/browser-editor/` (full list in session 10). The deletion runs after the replacement works.
- [ ] **D3** The editor is CodeMirror 6, loaded lazily. LaTeX: syntax, command and environment completion and `\begin` auto-close from `core/src/writing/latex/catalog` (`LATEX_COMMANDS`, `LATEX_ENVIRONMENTS`, `environmentToClose`), labels and refs, citation completion from `core/src/writing/citations`, compiler problems inline. Typst: Tinymist's completion, hover, diagnostics and go to definition through the helper (D4). Comments, history and versions as in VS Code; live collaboration through core `collab` and `y-codemirror.next`. Track changes is out of scope.
- [ ] **D4** Editing in the browser requires LabShelf Helper for both formats. The browser stops compiling Typst with typst.ts and stops downloading Typst fonts; the helper uses system fonts and resolves `@preview` packages natively. The helper is already standalone (`packages/terminal/src/helper/main.ts`, SEA binary and installers from plan browser-latex-helper); this plan adds a managed Tinymist binary, installed like the managed TeX (`documents/contracts/managed-tex.md`), which the helper runs for the browser and the VS Code extension runs as its own Typst language server, so VS Code no longer asks for the Tinymist extension.
- [ ] **D5** Transport between the extension and the helper:
  native messaging for discovery and handshake; a WebSocket on 127.0.0.1, random port, per-session token handed over native messaging, `Origin` checked against the extension origin (Firefox's per-install uuid learned over native messaging), binary frames; commands only on projects the extension opened, no arbitrary file read, no command execution; the helper reads project files from disk and the page sends edits; the helper returns only changed pages. Session 1 verifies Chrome's Local Network Access and Firefox behaviour for extension pages; if a browser blocks the socket, that browser uses native messaging only, with the same messages. `documents/contracts/helper.md` changes in session 4 (contract, tests first, `architecture-reviewer` after).
- [ ] **D6** Faster LaTeX in core's shared Node build (`core/src/writing/latex/build/`), so VS Code, the terminal app and the helper all gain: (a) a precompiled preamble format (`mylatexformat`, `.fmt`) rebuilt only when the preamble changes; (b) preview builds run one pass, the full build (bibliography, extra passes) runs on save or idle; (c) automatic `\includeonly` of the chapter being edited, other chapters' numbering kept from the last full build's `.aux`; (d) section preview: only section N compiled on the `.fmt` with the state of the last full build, only its pages swapped (detail in session 9). (a)–(c) land in session 3, (d) in session 9 with tests on state capture, restore and document assembly.
- [ ] **D7** The preview is the browser reader page in an iframe in preview mode (core reader `boot.preview`, reload keeps the position — [research/browser-runtime.md](research/browser-runtime.md)), updated page by page from the helper's changed pages.
- [ ] **D8** The options page chooses which sidebar sections show (Library, Projects); the code of a hidden section is not loaded.
- [ ] **D9** Performance budget on a mid-range laptop: each tab is a lazy chunk; scanners run debounced ~300 ms over the changed file off the hot path; saves debounced; the paper list and All projects lists are virtualized; closing a tab frees its editor or iframe. A headless Chrome check with 4x CPU throttle measures page open, editor ready to type and long tasks while typing (A9).
- [ ] **D10** Portable pieces that live only in `packages/vscode` move to core before the browser uses them ([research/core-reuse.md](research/core-reuse.md)): Files tree nodes, checklist sidebar nodes and rows, outline nesting and current heading, the portable All projects library, `createFile`, `toProjectRow`, the build summary over structural types, the gallery host and `useTemplate`. VS Code imports them from core. A core DOM editor area (tabs, two groups, sash; core tokens and icons) is new and goes through the `ui-design` skill. Browser templates: LabShelf Community and My templates over `LibraryFileSystem`; Typst Universe through the helper.
- [ ] **D11** No users and no real data exist: formats and protocol versions are replaced without migrations.

Other plans:

- **browser-editor**: superseded. Session 10 deletes its directory; its session 4 (collaboration) becomes session 11 here, on CodeMirror.
- **browser-latex-helper**: its session 7 (Firefox run, macOS screenshots) stays as is. Its D13 ("Typst compiles with typst.ts in the browser") and D3 ("the page owns the native port", now only for the handshake) are reversed by D4 and D5 here; `helper.md` changes in session 4 here.
- **browser-writing-companion**: its sessions that touch `library-page/` do not run alongside sessions 6–8 here.
- **project-collaboration**: session 11 here starts after its sessions 2–5, 7 and 10; its A12 is met by session 11.

Open (blocks approval):

- **Q1** The helper reads files from disk (D5), but a browser library can live in IndexedDB (`packages/browser/src/storage/indexedDbFileSystem.ts`), and the folder bridge `app.labshelf.bridge` has no standalone program (`documents/contracts/native-host.md`, "Precedence"), so a helper-only user has no folder library. Options: the helper also serves the bridge / IndexedDB projects keep the mirror `sync` path for the first open and send edits after; recommendation: the helper serves the bridge host, because then every editable project is on disk and the standalone promise of D4 holds; decided before session 4.
- **Q2** Managed Tinymist: a contract of its own (`managed-tinymist.md`) / a section of `managed-tex.md` renamed `managed-tools.md`; recommendation: extend into `managed-tools.md`, because folder, lock and resolution are the same rules.

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
- [ ] **A13** A comment, history and versions work in the browser editor; a browser user joins a project shared from VS Code and sees cursors both ways.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-transport-spike.md](sessions/1-transport-spike.md) | LNA / Firefox socket answer | `documents/plans/browser-project-workspace/research/` | 2, 3 |
| 2 | [sessions/2-core-moves.md](sessions/2-core-moves.md) | portable vscode pieces in core | `packages/core/src/writing/{projectTree,checklist,outline,allProjects,templates}/`, `packages/vscode/src/writing/{tree,checklist,outline,allProjects,templates}/` | 1, 3 |
| 3 | [sessions/3-latex-speed.md](sessions/3-latex-speed.md) | `.fmt`, one-pass preview, `\includeonly` | `packages/core/src/writing/latex/build/` | 1, 2 |
| 4 | [sessions/4-helper-socket.md](sessions/4-helper-socket.md) | helper.md v2, socket server, browser client | `documents/contracts/helper.md`, `packages/core/src/writing/helper/`, `packages/browser/src/helper/client/` | alone |
| 5 | [sessions/5-managed-tinymist.md](sessions/5-managed-tinymist.md) | managed Tinymist, LSP relay, VS Code language server | `packages/core/src/writing/typst/toolchain/`, managed-tools contract, `packages/vscode/src/writing/typst/`, `packages/vscode/package.json` | alone |
| 6 | [sessions/6-workspace-shell.md](sessions/6-workspace-shell.md) | core editor area, tabs, hash, sidebar, settings | `packages/core/src/library-ui/dom/editorArea/`, `packages/browser/src/library-page/`, `packages/browser/src/options/` | alone |
| 7 | [sessions/7-codemirror-latex.md](sessions/7-codemirror-latex.md) | CodeMirror, LaTeX features, preview | `packages/browser/src/library-page/editor/`, `.../preview/`, `packages/browser/package.json` | alone |
| 8 | [sessions/8-typst-panes.md](sessions/8-typst-panes.md) | Typst LSP, project panes, comments, history | `packages/browser/src/library-page/{editor/typst,projectPanes,review}/` | 9 |
| 9 | [sessions/9-section-preview.md](sessions/9-section-preview.md) | LaTeX section preview | `packages/core/src/writing/latex/build/section/`, helper LaTeX page diff | 8 |
| 10 | [sessions/10-delete-perf.md](sessions/10-delete-perf.md) | VS Code-in-browser removed, perf check | deleted paths of D2, build scripts, manifests | alone |
| 11 | [sessions/11-collaboration.md](sessions/11-collaboration.md) | live collaboration on CodeMirror | `packages/browser/src/library-page/editor/collab/`, `y-codemirror.next` entry | alone |

Order: 1 + 2 + 3 → 4 → 5 → 6 → 7 → 8 + 9 → 10 → 11. Q1 is decided before session 4.
