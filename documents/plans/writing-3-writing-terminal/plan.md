# Plan: writing from the terminal

Status: draft
Size: G — terminal commands over core logic built by the other writing plans; 2 sessions.
Pending decisions: 0

This plan uses the directory format. Read this file, then only `sessions/01.md` or `sessions/02.md`. `log.md` is append-only: add lines with `>>`, never read it whole.

## 1. Goal

People who write in Neovim, Helix or Emacs get the same writing environment from the `labshelf` command: the zero-configuration build with clear errors, a citation picker their editor can call, the pre-submission check, and all of it in CI so a pull request fails before a broken or de-anonymised paper goes out.

Builds on [writing-core.plan.md](../../archive/writing-core.plan.md), [submission-tools](../writing-2-submission-tools/plan.md) and [research-links](../writing-2-research-links/plan.md).

## 2. Decisions

- [ ] **D1** `labshelf build [project]` uses the core build runner, the same toolchain choice and cache dir as VS Code, and prints errors as `file:line: message` plus the hint, so editors' quickfix lists read them. `--watch` rebuilds on change. — One build, every app.
- [ ] **D2** `labshelf cite` opens a fuzzy picker over the library in the TUI style and prints the chosen key (`--format latex|typst|key`) to stdout, adding it to `labshelf.bib`. Editors bind it to a key. — The smallest bridge to any editor.
- [ ] **D3** `labshelf projects` lists projects; the TUI gets a Writing pane next to folders and papers. — The same model as the other apps.
- [ ] **D4** `labshelf check` runs the submission check and exits non-zero on findings; `labshelf install` fetches the project's papers. Both run headless. — The CI entry points.
- [ ] **D5** A documented GitHub Actions example builds with Tectonic, runs `labshelf check`, and uploads the PDF. No action is published by us. — CI without a service to maintain.

## 3. Scope

- **In:** the terminal app (CLI and TUI pane), a CI example in `documents/apps/terminal.md`.
- **Out:** a published GitHub Action; editor plugins for Neovim or Emacs (the commands are the interface).
- **Contracts touched:** none.

## 4. Acceptance criteria

- [ ] **A1** `labshelf build` in a LaTeX project on a machine without TeX offers Tectonic, builds, and prints errors as `file:line: message`.
- [ ] **A2** `labshelf cite --format latex` prints `\cite{key}` for the picked paper and updates `labshelf.bib`.
- [ ] **A3** The TUI shows a Writing pane listing projects.
- [ ] **A4** `labshelf check` exits 1 on a de-anonymised PDF and 0 on a clean one.
- [ ] **A5** The CI example runs green on a sample project.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| build, toolchain, log hints | `core/src/writing/latex/node/` | from writing-core |
| check | `core/src/writing/checks/` | from submission-tools |
| install | core | from research-links |
| commands, picker, Writing pane | `packages/terminal/src/cli/`, `packages/terminal/src/ui/` | glue only |

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | build, cite, projects (A1–A3) | yes, one per step |
| 2 | [sessions/02.md](sessions/02.md) | check, install, CI (A4, A5) | yes |

Runner tiers:

- **H**: the session model (Opus or Fable). Use it for design, algorithms and judgment.
- **M**: Sonnet. Use it for well-specified implementation, moves and tests.
- **L**: Haiku. Use it for gates, import fixes and commits.

## 7. Risks

- **R1** The picker and stdout conflict in editors that capture output. — Draw on `/dev/tty`, print only the result on stdout.

## 8. Log

See [log.md](log.md).
