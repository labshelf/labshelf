# Session 2 — Core `mountDetails` surface

- **Goal:** core can mount a standalone Details surface over one channel.
- **Starts from:** session 1 committed (the Details protocol is in `packages/core/src/details/protocol/`).
- **Ends with:** `mountDetails` is exported from `@labshelf/core/dom`. The apps still use their in-tab panes, which are removed in session 5.
- **Owns:** `packages/core/src/details/dom/`, `packages/core/src/library-ui/dom/hostMessages.ts` (only if it has to be split), `packages/core/src/dom/index.ts`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | `mountDetails` DOM surface | behaviour | implementer (opus) | typecheck passes; the surface mounts | [ ] |
| 2.2 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 2.1 — `mountDetails` surface

- **Goal:** a DOM entry that mounts paper or project details into any element, fed only by a `DetailsChannel`.
- **Read only:** `documents/plans/details-side-pane/research/core.md`, `packages/core/src/library-ui/dom/mountLibraryUi.ts:40-80`, `uiContext.ts`, `hostMessages.ts`, `detail/detailPane.ts:1-60,150-182`, `detail/detailActions.ts:40-75`, `packages/core/src/writing/allProjects/dom/mountAllProjects.ts:80-140`, `dom/detail/mountProjectDetail.ts`, `packages/core/src/details/protocol/messages.ts`.
- **Decided:**
  - `packages/core/src/details/dom/mountDetails.ts` exports `mountDetails(host, {transport: MessageEnd<DetailsToHost, HostToDetails>, prefs, capabilities, labels})`. It builds a root `div.ls-details` holding two slots, paper and project, and shows the slot that matches the current target.
  - The paper slot gets its own `LibraryViewStore` and `UiContext` (without a list) and calls `attachHostMessages` and `mountDetailPane`. Library-channel messages are fed in, and posts are wrapped. `details.show {kind:"paper", ids}` sets `selected` to those ids, ignoring ids not in `papers`. `focusList` is a no-op. Multi-row picking narrows the selection locally, per D6 (narrowing happens inside Details only). `openFolder` posts the folder-open message defined in `documents/contracts/details-host.md`. List-only handlers in `hostMessages.ts` (navigate, reveal, select, citationMap) must not break without a list. If `hostMessages.ts` has to be split for that, split it by responsibility.
  - The project slot uses `createDetailRequests` and `mountProjectDetail`. It keeps the rows and commands from the `projects` message, and requests the detail when `details.show {kind:"project"}` arrives.
  - With a `null` target, both slots are hidden and one empty state shows: "Select a paper or project to see its details." This sentence replaces the empty-state copy of both panes in this surface. Drop the list keyboard hints here, because keys belong to the list.
  - Detail CSS is not moved yet; give the root both `ls-details` and `ls-library` so the existing rules apply. Session 5 re-scopes the CSS.
  - Export the surface from `@labshelf/core/dom`.
- **Done when:** core typecheck and tests pass, the new files stay at or under 200 lines, and no directory goes over 8 files. A small DOM test exists if the package already has DOM tests; otherwise none, because this is UI glue.
- **Do not touch:** `buildFrame`, `mountLibraryUi`, the existing mount of `mountDetailPane`, and the apps.
