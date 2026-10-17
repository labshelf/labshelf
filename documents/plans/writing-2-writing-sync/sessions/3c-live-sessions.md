# Session 3c — coauthor notice and live sessions

- **Goal:** a user editing a project is told when a coauthor edits it too, and can start or join a live session in one step.
- **Starts from:** session 2 and plan `folder-sync` committed; projects are plain folders synced by the user's own tool.
- **Ends with:** A5 "With B editing in the shared folder, A sees the coauthor notice once the sync tool delivers B's change; "Start live session" opens an OCT room." The end-to-end run needs two machines sharing one project folder through a sync tool.
- **Owns:** `packages/vscode/src/writing/collaboration/`, `packages/vscode/__tests__/writing/collaboration/`, `packages/vscode/src/extension.ts` (one registration call), the `labshelf.liveSession.*` entries in `packages/vscode/package.json`

Runs alone: it changes `packages/vscode/package.json`. It never edits `packages/core/`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3c.1 | Coauthor notice | behaviour | implementer (sonnet), test first | notice tests | [ ] |
| 3c.2 | OCT bridge | behaviour | implementer (sonnet) | typecheck | [ ] |
| 3c.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 3c.1 — Coauthor notice

- **Goal:** when a file of an open project changes on disk without a save in this VS Code, show "Someone else is editing this project. Start a live session?".
- **Read only:** `packages/vscode/src/extension.ts` 50–115; `packages/vscode/src/writing/session/projectStore.ts`.
- **Decided:**
  - Input: a `vscode.workspace` file watcher on each open project's folder, minus changes that follow a save in this VS Code (`onDidSaveTextDocument`) and LabShelf's own writes (build output, `.labshelf/`). The sync tool names no author, so the notice names none.
  - A `registerCoauthorNotice` in `packages/vscode/src/writing/collaboration/`, called once from `extension.ts` with the Writing projects.
  - Rules: an outside change counts within 10 minutes of the last one; once per project per hour; only for open projects. Each shown notice writes a log line through `ILogger` with the project and the changed path.
  - The sync tool's delay is accepted, and the author's own second device may also trigger the notice. The "Start live session" action runs `labshelf.liveSession.start` (3c.2).
- **Done when:** tests first, with fake watcher and save events: shown for an outside change in an open project, not for an own save, not for a closed project, once per project per hour, logged when shown. Vscode typecheck and collaboration tests pass.
- **Do not touch:** `packages/core`, `registerWritingView.ts`.

## 3c.2 — OCT bridge

- **Goal:** "Start live session" opens an Open Collaboration Tools room, and a join path joins one.
- **Read only:** the 3c.1 notice; `packages/vscode/package.json` 21–40 and 536–560; one existing bridge to another extension's commands, `packages/vscode/src/writing/typst/` (registerTinymistBridge).
- **Decided:**
  - Open Collaboration Tools (MIT, public server run by TypeFox, end-to-end encrypted, cursors, follow and chat; self-hostable) provides the session. The bridge calls only the OCT commands `oct.createRoom` and `oct.joinRoom`. Embedding the OCT protocol library is out.
  - When the OCT extension is missing, the bridge offers to install it from the Marketplace.
  - Manifest entries are only the commands `labshelf.liveSession.start` and `labshelf.liveSession.join`.
  - A failed command shows a toast and logs with context.
- **Done when:** `pnpm --filter @labshelf/vscode typecheck` passes. No test: this is glue over OCT commands.
- **Do not touch:** `packages/core`.
