# Session 2b — Writing pane and projects

- **Goal:** the TUI shows a Writing pane, and `runProjects` lists projects.
- **Starts from:** session 1 committed.
- **Ends with:** A3: "The TUI shows a Writing pane listing projects." The pane renders in the TUI; `runProjects` is a tested command module (dispatch is session 3, where A3 is checked in a `--dump-frame` frame).
- **Owns:** `packages/terminal/src/ui/app/`, `packages/terminal/src/cli/projects/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2b.1 | TUI Writing pane | behaviour | implementer (sonnet), `ui-design` skill | typecheck of terminal | [ ] |
| 2b.2 | `runProjects` | behaviour | implementer (sonnet) | JSON shape test passes | [ ] |
| 2b.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## Shared shapes

Command module: `cli/projects/index.ts` exports `runProjects(ctx: AppContext, positionals, flags, io: Output): Promise<number>`; exit 0 ok, 1 errors. Session 3 wires dispatch; siblings 2a and 2c own `cli/build/`, `cli/cite/`, `cli/check/`, `cli/project/`.

## 2b.1 — Writing pane

- **Goal:** the TUI gets a Writing pane next to folders and papers listing the library's projects with format and main file.
- **Read only:** `packages/terminal/src/ui/app/types.ts:20-66` (`Focus`); `packages/terminal/src/ui/app/app.ts:1-80` (focus, layout); `packages/terminal/src/ui/app/drawing/folders.ts:1-27`; `packages/terminal/src/ui/app/drawing/frame.ts:1-32`; `packages/terminal/src/ui/app/state/listModel.ts:1-60`; `packages/core/src/writing/projectData/node/nodeProjectData.ts:1-34` (`listProjects`).
- **Decided:** `Focus` in `ui/app/types.ts` gains `"writing"`; Tab cycles folders, papers, writing; the pane is `drawing/writing.ts`; the empty state reads "No projects". `app.ts` is at 189 lines: split by responsibility before it passes 200. Vocabulary and theme from core (AGENTS.md section 2).
- **Done when:** `pnpm --filter @labshelf/terminal typecheck`; files at most 200 lines. No test (UI layout and copy).

## 2b.2 — Projects command

- **Goal:** `labshelf projects` lists projects; `--json` prints them as JSON.
- **Read only:** `packages/terminal/src/cli/project/installCommand.ts:1-51` (command shape); `packages/terminal/src/cli/usage.ts:1-41`; `packages/core/src/writing/project/projectEntry.ts:1-16`.
- **Done when:** a test in `packages/terminal/__tests__/cli/projects/` pins the JSON shape (the text listing gets no test); `pnpm --filter @labshelf/terminal typecheck && pnpm --filter @labshelf/terminal test`.
- **Do not touch (all packages):** `cli/libraryCommands.ts`, `cli/args.ts`, `cli/usage.ts`, `cli/cite/`, core.
