# Session 1b — Message seams

- **Goal:** the reader-host `citeInProject` message exists, and the browser runtime message types for the later sessions exist.
- **Starts from:** plan approved.
- **Ends with:** the reader-host `citeInProject` message with its handler and optional port; the browser runtime message types listed in 1b.1; `documents/contracts/reader-host.md` lists the message.
- **Owns:** `packages/core/src/reader/protocol.ts`, `packages/core/src/reader/protocol/`, `packages/core/src/reader/host/`, `packages/browser/src/platform/`, `documents/contracts/reader-host.md`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1b.1 | Task: split `platform/runtimeMessages.ts` (199 lines) into `platform/messages/` by area; add the later message types | task | main thread | typecheck of browser; grep shows no import of the old path | [ ] |
| 1b.2 | Reader-host `citeInProject` message | contract | implementer (sonnet), tests first | protocol and controller tests pass | [ ] |
| 1b.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 1b.1 — Task

- Split `packages/browser/src/platform/runtimeMessages.ts` by area (auth and sync, library, capture, writing) into `platform/messages/`, exported from `platform/index.ts`; `grep -rn "runtimeMessages" packages/browser/src` is empty after.
- Add these union members with their response types: `editor.insert {text, fallback}` answering `InsertOutcome = "inserted" | "copied" | "no-editor"`, `bib.link`, `bib.health`, `cite.inProject`, `sites.lookup`, `review.start`. Types only: handlers come in sessions 2b–2e, routing in session 3. Fields added to existing types are optional.
- No test (types and a move).

## 1b.2 — `citeInProject`

- **Goal:** the reader can ask its host to cite a paper in a project, with an optional page and quote.
- **Read only:** `packages/core/src/reader/protocol.ts:130-200` (webview→host union and `isWebviewMessage`); `packages/core/src/reader/host/ports.ts:1-78`; `packages/core/src/reader/host/shareMessages.ts:1-35` (a sibling handler); `packages/core/src/reader/host/hostController.ts` (dispatch only); `documents/contracts/reader-host.md:16-27`.
- **Decided:**
  - Message `{ command: "citeInProject"; paperId: string; page?: number; quote?: string }` (webview→host), validated in `isWebviewMessage`: reject a non-string id, a non-positive page, a quote over 2,000 characters.
  - The controller calls an optional host port `citeInProject(request)` declared in `reader/host/ports.ts`; a host without it shows the notice "Cite in project is not available here" through the notices port.
  - `protocol.ts` is at 200 lines: move the webview→host union and its guard into `reader/protocol/` if the addition passes 200.
  - Session 2d builds the reader button and the browser host on this message.
- **Done when:** tests in `packages/core/__tests__/reader/`, written first, pin validation and both controller paths; `reader-host.md` lists the message. `pnpm --filter @labshelf/core typecheck && pnpm --filter @labshelf/core test`.
- **Do not touch:** `packages/core/src/reader/dom/`; the VS Code host; session 1a's paths (`storage/`, `sync/`).
