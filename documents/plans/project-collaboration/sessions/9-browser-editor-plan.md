# Session 9 — Reconcile plan browser-editor

- **Goal:** the browser-editor plan joins shared projects with this plan's protocol instead of Open Collaboration Tools.
- **Starts from:** plan approved; may run beside session 2.
- **Ends with:** A12; documents only, no code.
- **Owns:** `documents/plans/browser-editor/**`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 9.1 | Rewrite the collaboration parts | task | main thread | edits made, limits hold | [ ] |
| 9.2 | Commit | — | `git commit` of Owns | committed | [ ] |

## 9.1 — Rewrite the collaboration parts

- **Read only:** `documents/plans/browser-editor/plan.md`, `sessions/04.md`; `documents/plans/project-collaboration/research/plan-overlaps.md`; `documents/plans/project-collaboration/plan.md` (D2, D4, D6, D8, D10, D11).
- **Steps:**
  - `plan.md` D6: "The editor page joins shared projects through plan `project-collaboration`'s protocol (`documents/contracts/collaboration.md`): Yjs over the same trystero transport, which the page runs natively; `y-monaco` binds the page's Monaco models; keys come from the same invite link; the page uses the project's relay list (`relay.md`). — One protocol for VS Code and the browser."
  - `plan.md` D7: the collaboration wiring in `packages/browser/src/editor/collab/` uses core `collab/` and `collab/dom/`; nothing is copied.
  - `plan.md` A4: "A comment added in the browser shows in VS Code and the other way round, live in a shared project." A5: "A browser user joins a project shared from VS Code with its invite link and sees the other people's cursors."
  - `plan.md` intro: session 4 also depends on plan `project-collaboration` sessions 2–5 and 7.
  - `sessions/04.md`: replace 4.1 "OCT" with "Join shared projects": `y-monaco` on the page's models, the core session and trystero transport, the invite link pasted in the page or passed from the Writing tab, the relay list; comments through the core comment store. Keep 4.2 with "start a live session" replaced by "share the project from VS Code and join it from the page". Owns gains the `yjs` and `y-monaco` dependency entries instead of OCT.
  - Leave everything else in that plan unchanged. Use present tense, no history words.
- **Done when:** `plan.md` ≤ 12,000 characters and each session ≤ 6,000; no "OCT" or "Open Collaboration" left in that plan.
