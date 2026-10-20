# Session 1 — Core Details protocol, selection hub and contracts

- **Goal:** define the Details channel, widen the selection messages, and add a tested selection hub.
- **Starts from:** the plan is approved, with a clean tree on the branch.
- **Ends with:** the Details protocol and `createSelectionHub` are exported from core, and their tests pass. `paper.selected` carries `ids` and All projects posts `project.selected`. The contracts are written. Acceptance covered: A8 (core part) and A9 (contracts).
- **Owns:** `packages/core/src/details/` (except `dom/`), `packages/core/src/library-ui/protocol/`, `packages/core/src/library-ui/dom/reportSelection.ts`, `packages/core/src/writing/allProjects/protocol/`, `packages/core/src/writing/allProjects/dom/mountAllProjects.ts`, `packages/core/__tests__/details/`, the matching protocol tests, `documents/contracts/details-host.md`, `documents/contracts/library-ui-host.md`, and the app hosts' `paper.selected` reads, which are only adjusted so they still compile.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1.1 | Protocol, hub, contracts | contract | implementer (opus) | tests fail first and then pass; contracts written | [ ] |
| 1.2 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 1.1 — Protocol, selection hub, contracts

- **Goal:** define the Details channel, widen the selection messages, and add a tested selection hub.
- **Read only:** `documents/plans/details-side-pane/research/core.md`, `packages/core/src/library-ui/protocol/messages.ts`, `messageGuards.ts`, `transport.ts`, `packages/core/src/library-ui/dom/reportSelection.ts`, `packages/core/src/writing/allProjects/protocol/messages.ts`, `parseAllProjectsMessage.ts`, `packages/core/src/writing/allProjects/dom/mountAllProjects.ts:95-140`, `documents/contracts/library-ui-host.md:39-98`.
- **Decided:**
  - `paper.selected` changes from `{id: string | null}` to `{ids: string[]}`, and `reportSelection` posts every selected id. Update the guard and the contract row at library-ui-host.md:51. Fix every host reader of `paper.selected` (`packages/vscode/src/ui/list/host/messageHandler.ts`, `packages/vscode/src/ui/list/listWebviewPanel.ts:151`, `packages/browser/src/library-page/host/hostController.ts:51`) to the new shape, without changing their behaviour: VS Code still marks the tree only when exactly one id is selected.
  - `AllProjectsToHost` gains `project.selected {id: string | null}`. `mountAllProjects` posts it on selection change and after `ready`, and `parseAllProjectsMessage` accepts it. `serveAllProjects` ignores it for now; the apps route it in sessions 3 and 4.
  - New folder `packages/core/src/details/` containing `index.ts`, `selectionHub.ts` and `protocol/` (`messages.ts`, `parseDetailsMessage.ts`, `index.ts`).
    - `DetailsTarget = {kind:"paper", ids:string[]} | {kind:"project", id:string} | null`.
    - `DetailsToHost = {channel:"library", msg: UiToHost} | {channel:"projects", msg: AllProjectsToHost}`.
    - `HostToDetails = {channel:"library", msg: HostToUi} | {channel:"projects", msg: HostToAllProjects} | {type:"details.show", target: DetailsTarget}`.
    - The parser validates the envelope and delegates the inner message to the existing guards.
  - `createSelectionHub(show: (t: DetailsTarget) => void)` returns `{publish(source, target), activate(source), current()}`. Sources are strings chosen by the apps. `publish` stores the target for that source and shows it. `activate` shows the stored target, or does nothing when that source has none. `current()` returns the last target shown, so a Details surface mounted late can catch up.
  - A paper action from Details that needs the list (`store.openFolder`) is posted on the library channel as a new message, which the host forwards to the list as `navigate`. Name the message and add it to library-ui-host.md.
  - Write `documents/contracts/details-host.md`. It covers the channel envelope, `details.show`, the startup order (Details posts `ready` on both channels; the host answers each the way it answers that protocol's `ready`, then sends `details.show` with `current()`), and "last selection wins".
- **Done when:**
  - Tests in `packages/core/__tests__/details/` cover: the hub (publish, then activate restoring each source's own last target, activate with no target, `current`), the envelope parser (valid and invalid envelopes, and an inner message that the wrapped guard rejects), and `paper.selected` with `ids`.
  - Tests are written first and seen failing. Then `pnpm --filter @labshelf/core typecheck test`, and the typecheck of vscode and browser, pass.
- **Do not touch:** `buildFrame`, the detail pane DOM, and the app UI (sessions 2–5).

