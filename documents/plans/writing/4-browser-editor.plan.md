# Plan: full editor in the browser extension

Status: draft
Size: GG — a new app surface built on a large dependency, a web build of the VS Code extension, and a file system over Drive; 4 sessions, the first a go/no-go spike.
Pending decisions: 1

## 1. Goal

Anyone can write a Typst (or LaTeX) project from the browser extension, with no install and no account other than their Google Drive: the same editor features as in VS Code, live Typst preview, comments and live sessions with coauthors. This gives Typst users for free what typst.app charges for (review comments, more storage), and keeps their files in their own Drive.

Builds on [writing-core.plan.md](1-writing-core.plan.md), [writing-sync.plan.md](2-writing-sync.plan.md) and [writing-browser-bridge.plan.md](3-writing-browser-bridge.plan.md).

## 2. Decisions

- [ ] **D1** The editor is not written by us: an extension page hosts `monaco-vscode-api`, which runs VS Code web extensions unmodified. It loads the LabShelf extension's web build and Tinymist's web build (Tinymist declares a `browser` entry). — Every writing feature is written once, as the VS Code extension; the editor itself is maintained upstream.
- [ ] **D2** The workbench shows only the editor, the LabShelf views and the panels a writer needs; no activity bar of a code IDE. — A writing tool, not a programming tool.
- [ ] **D3** Everything is bundled and pinned in the extension package. Upgrades happen when we choose, about once or twice a year. — Nothing breaks underneath us between releases.
- [ ] **D4** The page reuses the extension's Drive sign-in and the projects already in IndexedDB through a `FileSystemProvider`. Nothing is configured twice. — The reason vscode.dev was rejected.
- [ ] **D5** LaTeX compiles only on desktop. In the browser a LaTeX project edits and shows the last synced PDF; Typst compiles live through `typst.ts`. — No LaTeX engine runs as a web extension.
- [ ] **D6** Live sessions use Open Collaboration Tools, which ships a Monaco integration (`open-collaboration-monaco`), so a browser user and a VS Code user can share one session. — The same collaboration path as VS Code.

Open (blocks approval):

- **Q1** Go or no-go after the spike — options: go with `monaco-vscode-api` / fall back to a lighter single-file editor (CodeMirror + `typst.ts`, citations, merge on save); recommendation: decide on the spike's numbers (bundle size, cold start under 3 s, Tinymist web working).

## 3. Scope

- **In:** a web build of the VS Code extension; an editor page in the browser extension; the Drive-backed file system; OCT in the browser.
- **Out:** LaTeX compilation in the browser; vscode.dev as a target (possible as a side effect, not supported).
- **Contracts touched:** none beyond those of the plans it builds on.

## 4. Acceptance criteria

- [ ] **A1** "Edit" on a project in the browser's Writing tab opens the editor page with its files, without a second sign-in.
- [ ] **A2** In a Typst project, citation completion from the library, Tinymist diagnostics and the live preview work as in VS Code.
- [ ] **A3** Saving writes to IndexedDB and syncs to Drive with the three-way merge; the change reaches VS Code on the next sync.
- [ ] **A4** Comments added in the browser show in VS Code and the other way round.
- [ ] **A5** A browser user joins a live session started from VS Code and sees the host's cursor.
- [ ] **A6** A LaTeX project opens for editing and shows its last PDF with "Compile on desktop".
- [ ] **A7** Cold start of the editor page stays under 3 s on a mid-range laptop.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| web build of the extension | `packages/vscode/` (`browser` entry) | only code outside `node/` folders (refactor S10.10); the LaTeX build is absent |
| editor page | `packages/browser/src/editor/` | `monaco-vscode-api` service overrides, trimmed layout, loads the two web extensions from the package |
| project file system | `packages/browser/src/editor/` | `FileSystemProvider` over the IndexedDB project store |
| OCT in the browser | `packages/browser/src/editor/` | `open-collaboration-monaco` or the OCT web extension, per the spike |

## 6. Sessions and steps

### Session 1 — spike

- **Starts from:** writing-browser-bridge done; clean tree.
- **Ends with:** Q1 answered with numbers in §8.
- **Commit:** the spike on a throwaway branch; only the §8 note on the plan branch

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | MV3 page with `monaco-vscode-api`, a hello web extension and Tinymist web | — | H · main thread | numbers for size, cold start, CSP | [ ] |

### Session 2 — the extension on the web

- **Starts from:** session 1 decided "go"
- **Ends with:** the LabShelf extension runs in the spike page with citations, the Writing view and comments
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S2 | Web build of the VS Code extension; desktop-only features gated | S1 | H · main thread | builds; loads in the web host | [ ] |
| S3 | Finish | S2 | `finish` skill | gate passes | [ ] |

### Session 3 — the editor page

- **Starts from:** session 2 committed
- **Ends with:** A1–A4, A6, A7
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S4 | Editor page and trimmed layout | S2 | M · implementer (sonnet) | page opens a project | [ ] |
| S5 | `FileSystemProvider` over IndexedDB, save and sync | S4 | M · implementer (sonnet) | A1, A3 | [ ] |
| S6 | Typst preview and LaTeX read-only path | S5 | M · implementer (sonnet) | A2, A6 | [ ] |
| S7 | Finish, plus a `verify` run with a cold-start measurement | S4–S6 | `finish` + `verify` skills | A7 | [ ] |

### Session 4 — collaboration

- **Starts from:** session 3 committed
- **Ends with:** A4, A5
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S8 | OCT in the editor page | S5 | H · main thread | A5 | [ ] |
| S9 | Finish | S8 | `finish` skill | gate passes | [ ] |

### Step blocks

#### S1 — Spike

- **Do:** build a throwaway MV3 page that boots `monaco-vscode-api` with the extension and file services, loads a minimal web extension from the package and Tinymist's `extension.web.js`, opens a `.typ` file from memory.
- **Context:** the reader already needs `'wasm-unsafe-eval'`; Chrome 125 and Firefox 128 are the floor ([reader-host.md](../../contracts/reader-host.md)).
- **Done when:** §8 records bundle size, cold start, whether Tinymist diagnostics work, and the go/no-go.

#### S2 — Web build

- **Do:** add the `browser` entry and an esbuild target for the web extension host; replace remaining Node paths with ports already introduced by the refactor; show "Compile on desktop" for LaTeX builds.
- **Context:** refactor S10.10 lists what is Node-only.

#### S5 — File system

- **Do:** a `FileSystemProvider` for a `labshelf-project:` scheme over the IndexedDB project store; writes trigger the browser's sync debounce.

#### S8 — OCT

- **Do:** wire OCT so a room created in VS Code can be joined from the page and the other way round; reuse the OCT sign-in flow.

## 7. Risks

- **R1** `monaco-vscode-api` is too heavy for an extension page. — Q1 and the lighter fallback.
- **R2** Tinymist web lacks features in a non-vscode.dev host. — The spike checks diagnostics and completion first.
- **R3** Upgrading `monaco-vscode-api` costs a session. — Pinned (D3); upgrade on our schedule.

## 8. Log
