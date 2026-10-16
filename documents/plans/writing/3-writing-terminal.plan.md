# Plan: writing from the terminal

Status: draft
Size: G — terminal commands over core logic built by the other writing plans; 2 sessions.
Pending decisions: 0

## 1. Goal

People who write in Neovim, Helix or Emacs get the same writing environment from the `labshelf` command: the zero-configuration build with clear errors, a citation picker their editor can call, the pre-submission check, and all of it in CI so a pull request fails before a broken or de-anonymised paper goes out.

Builds on [writing-core.plan.md](../../archive/writing-core.plan.md), [submission-tools.plan.md](2-submission-tools.plan.md) and [research-links.plan.md](2-research-links.plan.md).

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

## 6. Sessions and steps

### Session 1 — build, cite, projects

- **Starts from:** writing-core done; clean tree.
- **Ends with:** A1–A3
- **Commit:** yes, one per step

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | `labshelf build` and `--watch` | — | M · implementer (sonnet) | A1 | [ ] |
| S2 | `labshelf cite` picker | — | M · implementer (sonnet) | A2 | [ ] |
| S3 | `labshelf projects` and the TUI Writing pane | — | M · implementer (sonnet) | A3 | [ ] |
| S4 | Finish, plus a terminal frame `verify` run | S1–S3 | `finish` + `verify` skills | gate passes | [ ] |

### Session 2 — check, install, CI

- **Starts from:** session 1 committed; submission-tools session 2 and research-links session 4 done
- **Ends with:** A4, A5
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S5 | `labshelf check` and `labshelf install` | — | M · implementer (sonnet) | A4 | [ ] |
| S6 | CI example and docs | S5 | M · implementer (sonnet) | A5 | [ ] |
| S7 | Finish | S5–S6 | `finish` skill | gate passes | [ ] |

### Step blocks

#### S1 — Build

- **Do:** a `build` command calling the core runner; the first-run toolchain prompt in the terminal; output lines `path:line: severity: message` then the hint indented; exit codes 0 / 1 (errors) / 2 (toolchain missing).

#### S2 — Cite

- **Do:** a full-screen picker reusing the TUI list and the core search; print the formatted citation; regenerate `labshelf.bib` in the project of the current directory.
- **Context:** stdout carries only the citation, so editors can capture it; the UI draws on the TTY.

#### S5–S6 — CI

- **Do:** `check` and `install` commands with `--json` output; a workflow example installing LabShelf and Tectonic, running `labshelf install`, `labshelf build` and `labshelf check`, and uploading `main.pdf`.

## 7. Risks

- **R1** The picker and stdout conflict in editors that capture output. — Draw on `/dev/tty`, print only the result on stdout.

## 8. Log
