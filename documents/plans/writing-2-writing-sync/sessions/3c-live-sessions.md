# Session 3c — coauthor notice and live sessions

- **Goal:** a user editing a project is told when a coauthor edits it too, and can start or join a live session in one step.
- **Starts from:** session 2 committed; `SyncResult.coauthors?` exists (session 3a fills it).
- **Ends with:** A5 "With B editing, A sees the coauthor notice within one sync; "Start live session" opens an OCT room." The end-to-end run on two accounts needs 3a committed.
- **Owns:** `packages/vscode/src/writing/collaboration/`, `packages/vscode/__tests__/writing/collaboration/`, `packages/vscode/src/extension.ts` (one registration call), the `labshelf.liveSession.*` entries in `packages/vscode/package.json`

Runs alone: it changes `packages/vscode/package.json`. It reads `SyncResult.coauthors` only through the seam and never edits `packages/core/`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3c.1 | Coauthor notice | behaviour | implementer (sonnet), test first | notice tests | [ ] |
| 3c.2 | OCT bridge | behaviour | implementer (sonnet) | typecheck | [ ] |
| 3c.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 3c.1 — Coauthor notice

- **Goal:** when a run reports a coauthor on an open project, show "<name> is editing this project. Start a live session?".
- **Read only:** `packages/vscode/src/sync/adapter/syncController.ts` 55–65 and 155–165 (`onDidSync`); `packages/vscode/src/extension.ts` 50–115; `packages/vscode/src/writing/session/projectStore.ts`; `packages/core/src/sync/engine/syncTypes.ts` (the `CoauthorActivity` seam).
- **Decided:**
  - Input: `SyncResult.coauthors?: CoauthorActivity[]` with `CoauthorActivity = {projectId: string; name: string; email?: string; modifiedTime: string}`. Core already applies the 10-minute window and excludes the signed-in user.
  - A `registerCoauthorNotice` in `packages/vscode/src/writing/collaboration/`, called once from `extension.ts` with the sync controller's `onDidSync` and the Writing projects.
  - The notice adds only two rules: once per coauthor per project per hour, and only for open projects. Each shown notice writes a log line through `ILogger` with the project and coauthor.
  - The ~30 s sync delay is accepted. The "Start live session" action runs `labshelf.liveSession.start` (3c.2).
- **Done when:** tests first, with fake runs: shown for an open project, not for a closed one, once per coauthor per hour, logged when shown. Vscode typecheck and collaboration tests pass.
- **Do not touch:** `packages/core`, `packages/vscode/src/sync/`, `registerWritingView.ts`.

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
