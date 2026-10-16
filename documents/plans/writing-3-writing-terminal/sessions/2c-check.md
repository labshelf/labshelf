# Session 2c — check and install

- **Goal:** `runCheck` and a headless `runInstall --json` exist as tested command modules.
- **Starts from:** session 1 committed (`builtPdfPath` in core).
- **Ends with:** A4: "`labshelf check` exits 1 on a de-anonymised PDF and 0 on a clean one." pinned in tests; dispatch and the real run are session 3.
- **Owns:** `packages/terminal/src/cli/check/`, `packages/terminal/src/cli/project/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2c.1 | `runCheck` | behaviour | implementer (sonnet), test first | A4 logic in tests | [ ] |
| 2c.2 | `runInstall --json`, headless | behaviour | implementer (sonnet), test first | install tests pass | [ ] |
| 2c.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## Shared shapes

Command module: `cli/check/index.ts` exports `runCheck(ctx: AppContext, positionals, flags, io: Output): Promise<number>`; exit 0 ok, 1 findings or errors, 2 toolchain or build missing. Session 3 wires dispatch and owns `cli/project/projectCommands.ts` and `cli/project/index.ts` (do not edit those two; the rest of `cli/project/` is yours). Core seam: `builtPdfPath(project)` in `packages/core/src/writing/build/node/index.ts`; `checkProject({ folder, pdfPath, settings }, pdfjs, logger): Promise<CheckFinding[]>` in `packages/core/src/writing/checks/node/index.ts` exists.

## 2c.1 — Check

- **Goal:** `labshelf check [project]` runs the submission check on the built PDF and exits 1 on findings, 0 on none.
- **Read only:** `packages/core/src/writing/checks/node/checkProject.ts:1-45`; `packages/core/src/writing/checks/checkTypes.ts:1-43`; `packages/vscode/src/writing/check/node/registerCheckCommand.ts:20-60` (what VS Code does around it); `packages/core/src/writing/build/node/index.ts` (`builtPdfPath`); `packages/terminal/src/app/context.ts:1-60` (the pdfjs loader).
- **Decided:** no built PDF gives exit 2 with "Run labshelf build first". Text output `path:line: severity: message` for source findings, `main.pdf: page N: …` for PDF ones; `--json` prints the findings array.
- **Done when:** tests in `packages/terminal/__tests__/cli/check/`, written first, pin exit 1 on a de-anonymised fixture PDF, 0 on a clean one, and the JSON shape.

## 2c.2 — Install

- **Goal:** `labshelf install` runs without a TTY and prints `--json`.
- **Read only:** `packages/terminal/src/cli/project/installCommand.ts:1-51`; `packages/core/src/writing/project/install/installSummary.ts`.
- **Done when:** tests in `packages/terminal/__tests__/cli/project/`, written first, pin the JSON shape and a non-TTY run; `pnpm --filter @labshelf/terminal typecheck && pnpm --filter @labshelf/terminal test`.
- **Do not touch (all packages):** `cli/libraryCommands.ts`, `cli/args.ts`, `cli/usage.ts`, core; siblings' folders (`cli/build/`, `cli/cite/`, `cli/projects/`, `ui/app/`).
