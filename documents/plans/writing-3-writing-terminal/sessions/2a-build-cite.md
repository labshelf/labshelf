# Session 2a — build and cite

- **Goal:** `runBuild` (with `--watch`) and `runCite` exist as tested command modules.
- **Starts from:** session 1 committed (core `buildProject` seam).
- **Ends with:** A1: "`labshelf build` in a LaTeX project on a machine without TeX offers Tectonic, builds, and prints errors as `file:line: message`." and A2: "`labshelf cite --format latex` prints `\cite{key}` for the picked paper and updates `labshelf.bib`." pinned in tests; dispatch and the real run are session 3.
- **Owns:** `packages/terminal/src/cli/build/`, `packages/terminal/src/cli/cite/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2a.1 | `runBuild` and `--watch` | behaviour | implementer (sonnet), test first | A1 logic in tests | [ ] |
| 2a.2 | `runCite` picker | behaviour | implementer (sonnet), test first | A2 logic in tests | [ ] |
| 2a.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## Shared shapes

- Command module: `cli/<command>/index.ts` exports `run<Name>(ctx: AppContext, positionals, flags, io: Output): Promise<number>`. Exit 0 ok, 1 findings or errors, 2 toolchain missing. Wave-mates (2b, 2c) own other `cli/` folders; session 3 wires dispatch and flags (`--watch` boolean, `--format latex|typst|key` value flag); tests here pass already-parsed flags.
- Core build seam (session 1), in `packages/core/src/writing/build/node/index.ts`: `buildProject(project, deps): Promise<ProjectBuildResult>`; `deps.toolchain: ToolchainPrompt`; `ProjectBuildQueue.request(project)`; `builtPdfPath(project)`.

## 2a.1 — Build

- **Goal:** `labshelf build [project]` builds through the core runner and prints `path:line: severity: message`, then the hint indented.
- **Read only:** `packages/core/src/writing/build/node/index.ts`; `packages/terminal/src/cli/project/installCommand.ts:1-51` (command shape, project lookup); `packages/terminal/src/cli/usage.ts:1-41` (`Output`, `UsageError`); `packages/terminal/src/app/context.ts:1-60`; `packages/terminal/src/library/libraryWatcher.ts` (watching).
- **Decided:** the project is the argument or the one containing the cwd; `ToolchainPrompt` asks on the TTY, and without a TTY declines (exit 2 with the Tectonic hint). `--watch` uses `ProjectBuildQueue` on source changes until Ctrl-C.
- **Done when:** tests in `packages/terminal/__tests__/cli/build/`, written first, pin the line format, the exit codes and one rebuild on change with a fake runner.

## 2a.2 — Cite

- **Goal:** `labshelf cite` opens a fuzzy picker on `/dev/tty`, prints the chosen citation (`--format latex|typst|key`) on stdout and updates `labshelf.bib`.
- **Read only:** `packages/terminal/src/ui/textInput.ts:1-82`; `packages/terminal/src/ui/render.ts`; `packages/core/src/library/search/text/fuzzy.ts:1-30`; `packages/core/src/reader/citationFormat.ts:1-42`; `packages/core/src/writing/citations/node/projectBibliography.ts:1-79`.
- **Decided:** the picker draws only on `/dev/tty` and stdout carries the citation alone, so editors that capture output work. `packages/terminal/src/ui/` is read-only here (session 2b owns `ui/app/`); a needed change there is reported back.
- **Done when:** tests in `packages/terminal/__tests__/cli/cite/`, written first, pin output per format, the `labshelf.bib` update and cancel (exit 1, empty stdout); `pnpm --filter @labshelf/terminal typecheck && pnpm --filter @labshelf/terminal test`.
- **Do not touch (all packages):** `cli/libraryCommands.ts`, `cli/args.ts`, `cli/usage.ts`, `ui/`, core; siblings' folders (`cli/projects/`, `cli/check/`, `cli/project/`).
