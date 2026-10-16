# Plan: writing from the terminal

Status: draft
Size: 5 sessions — terminal commands over core logic built by the other writing plans, plus moving the project build into core.

## 1. Goal

People who write in Neovim, Helix or Emacs get the same writing environment from the `labshelf` command: the zero-configuration build with clear errors, a citation picker their editor can call, the pre-submission check, and all of it in CI so a pull request fails before a broken or de-anonymised paper goes out.

Builds on the archived writing-core plan, writing-2-submission-tools and writing-2-research-links. The submission check (`checkProject` in `packages/core/src/writing/checks/node/`) and `labshelf install` (`packages/terminal/src/cli/project/installCommand.ts`) exist, so those plans block nothing here.

## 2. Decisions

- [ ] **D1** `labshelf build [project]` uses the core build runner, the same toolchain choice and cache dir as VS Code, and prints errors as `file:line: message` plus the hint, so editors' quickfix lists read them. `--watch` rebuilds on change. — One build, every app.
- [ ] **D2** `labshelf cite` opens a fuzzy picker over the library in the TUI style and prints the chosen key (`--format latex|typst|key`) to stdout, adding it to `labshelf.bib`. Editors bind it to a key. The picker draws on `/dev/tty` and stdout carries only the result, so editors that capture output work. — The smallest bridge to any editor.
- [ ] **D3** `labshelf projects` lists projects; the TUI gets a Writing pane next to folders and papers. — The same model as the other apps.
- [ ] **D4** `labshelf check` runs the submission check and exits non-zero on findings; `labshelf install` fetches the project's papers. Both run headless. — The CI entry points.
- [ ] **D5** A documented GitHub Actions example builds with Tectonic, runs `labshelf check`, and uploads the PDF. No action is published by us. — CI without a service to maintain.
- [ ] **D6** The project build is missing from core: toolchain choice, the per-project build queue and the built PDF path live in `packages/vscode/src/writing/build/` and `writing/typst/node/typstBuilds.ts`. Session 1 moves them to `packages/core/src/writing/build/` (Node code in `node/`) before the terminal copies them, and VS Code builds through the core runner. Seam: `buildProject(project, deps): Promise<ProjectBuildResult>`; `deps.toolchain: ToolchainPrompt` (pick an engine, confirm the Tectonic download); `ProjectBuildQueue.request(project)` cancels the running build and queues one; `builtPdfPath(project)`. — AGENTS.md section 1: no copy between apps.
- [ ] **D7** Command modules export `run<Name>(ctx: AppContext, positionals, flags, io: Output): Promise<number>` from `packages/terminal/src/cli/<command>/index.ts`. Exit codes: 0 ok, 1 findings or errors, 2 toolchain missing. Session 3 owns dispatch, flags and usage. Flags: `--watch` boolean, `--format latex|typst|key` value flag, `--json` (exists). — Tested command modules first, wiring last.
- [ ] **D8** Out of scope: a published GitHub Action; editor plugins for Neovim or Emacs (the commands are the interface). No contract documents change. In scope: the terminal app (CLI and TUI pane) and a CI example in `documents/apps/terminal.md`. — Keeps the plan to the terminal.

Open (blocks approval): none.

## 3. Acceptance

- [ ] **A1** `labshelf build` in a LaTeX project on a machine without TeX offers Tectonic, builds, and prints errors as `file:line: message`.
- [ ] **A2** `labshelf cite --format latex` prints `\cite{key}` for the picked paper and updates `labshelf.bib`.
- [ ] **A3** The TUI shows a Writing pane listing projects.
- [ ] **A4** `labshelf check` exits 1 on a de-anonymised PDF and 0 on a clean one.
- [ ] **A5** The CI example runs green on a sample project.

## 4. Sessions

Sessions run in order. A session that changes `package.json`, the lockfile, a tsconfig or a build script runs alone. Paths in Owns are repository-relative.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-core-build.md](sessions/1-core-build.md) | core project build runner with a toolchain port; VS Code on it | `packages/core/src/writing/build/`, `packages/vscode/src/writing/build/`, `packages/vscode/src/writing/typst/node/` | alone |
| 2a | [sessions/2a-build-cite.md](sessions/2a-build-cite.md) | `build`, `--watch` and the `cite` picker | `packages/terminal/src/cli/build/`, `packages/terminal/src/cli/cite/` | 2b, 2c |
| 2b | [sessions/2b-writing-pane.md](sessions/2b-writing-pane.md) | TUI Writing pane and `projects` | `packages/terminal/src/ui/app/`, `packages/terminal/src/cli/projects/` | 2a, 2c |
| 2c | [sessions/2c-check.md](sessions/2c-check.md) | `check` with exit codes and `--json`; `install` headless | `packages/terminal/src/cli/check/`, `packages/terminal/src/cli/project/` | 2a, 2b |
| 3 | [sessions/3-wiring-ci.md](sessions/3-wiring-ci.md) | dispatch, flags, usage; real run; CI example | `packages/terminal/src/cli/libraryCommands.ts`, `packages/terminal/src/cli/args.ts`, `packages/terminal/src/cli/usage.ts`, `packages/terminal/src/cli/index.ts`, `packages/terminal/src/cli/project/projectCommands.ts`, `packages/terminal/src/cli/project/index.ts`, `documents/apps/terminal.md` | alone |
