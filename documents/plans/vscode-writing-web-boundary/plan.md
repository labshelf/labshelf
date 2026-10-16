# Plan: VS Code writing code behind the web boundary

Status: in progress (session 2 of 3)
Size: G — about 45 VS Code files, one new core port, 13 test files; grows to GG if the core data functions behind the port need rewriting instead of delegation
Pending decisions: 0

## 1. Goal

`pnpm run lint:deps` passes on `feat/reader-ux`: the 63 violations go (61 in `packages/vscode/src/writing/`, `src/continue/` and `src/ui/list/host/projectSource.ts`, plus 2 imports past an index). The fix keeps the rule's intent: VS Code code outside `node/` stays web-safe, so the web build in `writing-4-browser-editor` is not blocked later. A new rule keeps the writing-2 sessions from adding the violations back.

## 2. Decisions

Facts behind them: [research/violations.md](research/violations.md), [research/plan-overlap.md](research/plan-overlap.md).

- [x] **D1** Types that live only under core `node/` (`ProjectEntry`, `LocatedProblem`, `OpenSources`, `ProjectVersion`, `PdfjsLoader`, `LatexBuildResult`, `FigureRunResult`) move to neutral core files in their domain, and the `node/` files import them back. Type-only moves are the cheapest fix and serve the terminal too.
- [x] **D2** Neutral writing code gets path operations from the injected `PathOps` (`HostAdapters.paths`), never from `node:path` and never from `posixPathOps`, because project paths are OS paths (Windows). If a file needs a member `PathOps` lacks (`relative`, `isAbsolute`, `resolve`), that member is added to `PathOps`, to `posixPathOps` and to the Node adapter in the same step.
- [x] **D3** File reads and stats in neutral code (`builtPdf.ts`, `sourceLineAt.ts`, the `stat` in `continueTargets.ts`) go through `vscode.workspace.fs`, which works in a web extension.
- [x] **D4** Project data operations (listing projects, project settings, values, figure states, backlinks, synctex, cursor and last edit, bibliography, create, add and unregister a folder) go behind one neutral port declared in core (`core/src/writing/project/`). It covers only the functions the VS Code files call. Its Node implementation in core `node/` delegates to the existing functions, which are not rewritten. The VS Code composition root puts the port on `HostAdapters`. This follows AGENTS.md §1 ("core declares the interface, the app implements it"), and the terminal can use the same port.
- [x] **D5** Code that spawns processes or needs a real disk path for an external tool (LaTeX and Typst builds, the Typst compiler host, tectonic and toolchain setup, figure regeneration, the project check, PDF compare) moves into `node/` subfolders of its feature. It is registered from a Node composition root (`writing/node/`, called from `extension.ts`). Neutral VS Code code never imports a VS Code `node/` folder, and a new depcruise rule enforces this (S3.3).

Open: none. The branch is `feat/reader-ux`, as the request says.

## 3. Scope

- **In:** `packages/vscode/src/writing/**`, `src/continue/**`, `src/ui/list/host/projectSource.ts`, `src/extension.ts`, `src/activation/**` (adapters), their tests, the core types and port of D1 and D4, `core/src/writing/versions/node/buildMarkedUpDiff.ts`, `.dependency-cruiser.cjs`, `documents/architecture.md`.
- **Out:** behaviour changes; rewriting core `node/` logic onto `IFileSystem`; the web build itself (`writing-4-browser-editor` S2); the tabProbe test (done while this plan was written).
- **Contracts touched:** none.

## 4. Acceptance criteria

- [ ] **A1** `pnpm run lint:deps` exits 0 with 0 violations.
- [ ] **A2** `pnpm -r typecheck` and `pnpm -r test` pass, with the moved tests still mirroring `src/`.
- [ ] **A3** No file under `packages/vscode/src/` outside a `node/` folder imports `node:*`, `@labshelf/core/node` or core `*/node/*` (A1 proves this; this item names the intent).
- [ ] **A4** A new depcruise rule fails when VS Code code outside `node/` imports a VS Code `node/` folder, with `extension.ts` as the only exception. Shown by adding a temporary violation and seeing the rule fire.
- [ ] **A5** The extension host still runs the writing features on a copy of the library: open a project, build LaTeX and Typst, open the preview, compare versions (`verify` skill, extension-host recipe).
- [ ] **A6** `documents/architecture.md` states D4 and D5 in one place, and the open writing-2 plans link to it for where Node-using writing code goes.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| neutral types (D1) | `core/src/writing/<domain>/*.ts`, `core/src/import/` for `PdfjsLoader` | exported from `@labshelf/core` |
| `WritingProjectsPort` (D4) | `core/src/writing/project/` (interface), `core/src/writing/project/node/` (delegating implementation) | name settled in S2.1; one method per function the VS Code code calls today |
| `HostAdapters.writing` | `vscode/src/activation/serviceComposition/hostAdapters.ts`, `activation/node/nodeAdapters.ts` | same pattern as `paths` and `createSidecarPort` |
| Node writing features (D5) | `vscode/src/writing/<feature>/node/` | registered from `vscode/src/writing/node/` (one register function), called by `extension.ts` |
| boundary rule (D5) | `.dependency-cruiser.cjs` | `vscode-neutral-no-vscode-node-folder` |

Pure path helpers in core `node/` (`projectBuildDir`, `valueFilePath`, `rootFileNames`) move to neutral core when they use only path logic. S2.1 checks each one.

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | neutral types, paths, workspace.fs, index fixes (the T, P and F violations) | yes |
| 2 | [sessions/02.md](sessions/02.md) | `WritingProjectsPort` in core, wired through `HostAdapters`, consumers switched | yes |
| 3 | [sessions/03.md](sessions/03.md) | Node features in `node/` folders, boundary rule, docs, extension-host verify | yes |

Runner tiers: **H** session model · **M** Sonnet · **L** Haiku.

## 7. Risks

- **R1** The `feat/writing-core` worktree (same commit `a24b122`) runs writing-2 sessions that add files to `vscode/src/writing/`. Moves here will conflict when it merges. Mitigation: S3.4 adds the placement rule to those plans. Rebase `feat/writing-core` onto this plan's commits before its next session.
- **R2** Threading `PathOps` and the port through 31 importers of `mainDocument.ts` and 36 of `projectStore.ts` inflates the diff. Mitigation: inject once into `WritingProjects` (the store) and the writing context. Do not add parameters to every function.
- **R3** Tests mock `node:fs` or `node:path` directly. Mitigation: switch those tests to fake ports, which is cheaper than keeping the mocks.
- **R4** Some project data functions also spawn processes. Mitigation: S2.1 sorts every function into the port (D4) or a `node/` move (D5) before any code changes.

## 8. Log

See [log.md](log.md).
