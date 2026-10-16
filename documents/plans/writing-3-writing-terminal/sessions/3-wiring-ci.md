# Session 3 — Wiring and CI

- **Goal:** `build`, `cite`, `projects` and `check` run from `labshelf`, and a CI example proves them.
- **Starts from:** sessions 2a, 2b and 2c committed (`runBuild`, `runCite`, `runProjects`, `runCheck`, headless `runInstall`).
- **Ends with:** the four commands reachable from `labshelf`; in a real run:
  - A1 `labshelf build` in a LaTeX project on a machine without TeX offers Tectonic, builds, and prints errors as `file:line: message`.
  - A2 `labshelf cite --format latex` prints `\cite{key}` for the picked paper and updates `labshelf.bib`.
  - A3 The TUI shows a Writing pane listing projects.
  - A4 `labshelf check` exits 1 on a de-anonymised PDF and 0 on a clean one.
  - A5 The CI example runs green on a sample project.
- **Owns:** `packages/terminal/src/cli/libraryCommands.ts`, `packages/terminal/src/cli/args.ts`, `packages/terminal/src/cli/usage.ts`, `packages/terminal/src/cli/index.ts`, `packages/terminal/src/cli/project/projectCommands.ts`, `packages/terminal/src/cli/project/index.ts`, `documents/apps/terminal.md`

Runs alone.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Dispatch, `--watch` and `--format` flags, usage text | behaviour | implementer (sonnet), test first for flag parsing | args tests pass | [ ] |
| 3.2 | CI example in `documents/apps/terminal.md` | task | main thread | A5 green | [ ] |
| 3.3 | Real run of A1–A4 | — | `verify` skill | A1–A4 | [ ] |
| 3.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 3.1 — Dispatch

- **Goal:** the four commands run from `labshelf`, with their flags and help.
- **Read only:** `packages/terminal/src/cli/libraryCommands.ts:50-80`; `packages/terminal/src/cli/args.ts:1-61`; `packages/terminal/src/cli/usage.ts:1-41`; the `index.ts` of `cli/build/`, `cli/cite/`, `cli/projects/`, `cli/check/`.
- **Decided:** command modules export `run<Name>(ctx: AppContext, positionals, flags, io: Output): Promise<number>`; exit 0 ok, 1 findings or errors, 2 toolchain missing. `libraryCommands.ts` is at 219 lines: the project commands (`install`, `build`, `cite`, `projects`, `check`) dispatch from `cli/project/projectCommands.ts`, which this session creates. `format` is a value flag (`latex|typst|key`), `watch` a boolean, `--json` exists.
- **Done when:** tests in `packages/terminal/__tests__/cli/` pin `--format latex` parsed as a value and `--watch` as a boolean; dispatch glue gets no test. `libraryCommands.ts` at most 200 lines. `pnpm --filter @labshelf/terminal typecheck && pnpm --filter @labshelf/terminal test`.

## 3.2 — CI example

- A GitHub Actions workflow in `documents/apps/terminal.md` installs LabShelf and Tectonic, runs `labshelf install`, `labshelf build`, `labshelf check`, and uploads the PDF. No action is published by us. Run it on a sample project repository and report the run URL.

## 3.3 — Verify

- The real run is the deliverable. Per `documents/apps/README.md#verifying-changes`: A1 on a machine state without TeX (isolated PATH), A2 in a pty (the picker draws on `/dev/tty`, stdout carries only the citation), A3 by `--dump-frame`, A4 on the two fixture PDFs.
