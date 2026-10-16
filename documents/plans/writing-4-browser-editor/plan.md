# Plan: full editor in the browser extension

Status: draft
Size: 4 sessions — a go/no-go spike, then a web build of the VS Code extension, an editor page with a Drive-backed file system, and collaboration.

## 1. Goal

Anyone can write a Typst (or LaTeX) project from the browser extension, with no install and no account other than their Google Drive: the same editor features as in VS Code, live Typst preview, comments and live sessions with coauthors. This gives Typst users for free what typst.app charges for (review comments, more storage), and keeps their files in their own Drive.

Builds on the archived writing-core plan, writing-2-writing-sync and writing-3-writing-browser-bridge; none of them blocks the spike.

## 2. Decisions

- [ ] **D1** The editor is not written by us: an extension page hosts `monaco-vscode-api`, which runs VS Code web extensions unmodified. It loads the LabShelf extension's web build and Tinymist's web build (Tinymist declares a `browser` entry). — Every writing feature is written once, as the VS Code extension; the editor itself is maintained upstream.
- [ ] **D2** The workbench shows only the editor, the LabShelf views and the panels a writer needs; no activity bar of a code IDE. — A writing tool, not a programming tool.
- [ ] **D3** Everything is bundled and pinned in the extension package. Upgrades happen when we choose, about once or twice a year. — Nothing breaks underneath us between releases, and an upgrade costs one session on our schedule.
- [ ] **D4** The page reuses the extension's Drive sign-in and the projects already in IndexedDB through a `FileSystemProvider` for the `labshelf-project:` scheme. Nothing is configured twice. — The reason vscode.dev was rejected.
- [ ] **D5** LaTeX compiles only on desktop. In the browser a LaTeX project edits and shows the last synced PDF with "Compile on desktop"; Typst compiles live through `typst.ts`. — No LaTeX engine runs as a web extension.
- [ ] **D6** Live sessions use Open Collaboration Tools, which ships a Monaco integration (`open-collaboration-monaco`), so a browser user and a VS Code user can share one session. — The same collaboration path as VS Code.
- [ ] **D7** Placement: the web build of the extension lives in `packages/vscode/` (a `browser` entry and an esbuild target) and contains only code outside `node/` folders; the LaTeX build is absent. The editor page, the file system provider and OCT wiring live in `packages/browser/src/editor/`. No code is copied between the two apps, and `core` contracts do not change. — AGENTS.md section 1.
- [ ] **D8** Out of scope: LaTeX compilation in the browser; vscode.dev as a target (it may work as a side effect and is not supported). Contract documents do not change beyond those of the plans this one builds on. — Keeps the plan to the editor page.
- [ ] **D9** Risks and their answers: `monaco-vscode-api` too heavy for an extension page → Q1 and the lighter fallback; Tinymist web lacking features outside vscode.dev → the spike checks diagnostics and completion first; an upgrade of `monaco-vscode-api` → pinned (D3).

Open (blocks sessions 2 to 4):

- **Q1** Go or no-go after the spike — go with `monaco-vscode-api` / fall back to a lighter single-file editor (CodeMirror + `typst.ts`, citations, merge on save); recommendation: decide on the spike's numbers (bundle size, cold start under 3 s, Tinymist web working). On no-go, sessions 2 to 4 are replaced by a plan for the fallback.

## 3. Acceptance

- [ ] **A1** "Edit" on a project in the browser's Writing tab opens the editor page with its files, without a second sign-in.
- [ ] **A2** In a Typst project, citation completion from the library, Tinymist diagnostics and the live preview work as in VS Code.
- [ ] **A3** Saving writes to IndexedDB and syncs to Drive with the three-way merge; the change reaches VS Code on the next sync.
- [ ] **A4** Comments added in the browser show in VS Code and the other way round.
- [ ] **A5** A browser user joins a live session started from VS Code and sees the host's cursor.
- [ ] **A6** A LaTeX project opens for editing and shows its last PDF with "Compile on desktop".
- [ ] **A7** Cold start of the editor page stays under 3 s on a mid-range laptop.

## 4. Sessions

Sessions run in order. Every session after the spike adds dependencies or changes a build script, so each runs alone. Paths in Owns are repository-relative.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | Spike: Q1 answered with numbers | `packages/browser/src/editor-spike/` on a throwaway branch, `documents/plans/writing-4-browser-editor/log.md` (append only) | alone |
| 2 | [sessions/02.md](sessions/02.md) | The VS Code extension runs on the web | `packages/vscode/` (manifest, build, composition root), `packages/vscode/__tests__/` | alone |
| 3 | [sessions/03.md](sessions/03.md) | The editor page: A1, A2, A3, A6, A7 | `packages/browser/src/editor/`, `packages/browser/__tests__/editor/`, browser manifest and build | alone |
| 4 | [sessions/04.md](sessions/04.md) | Collaboration and comments: A4, A5 | `packages/browser/src/editor/collab/` | alone |
