# Session 8 — Docs, finish and hand check

- **Goal:** the docs describe Spaces as built, the whole change passes the finishing pass, and the user checks the screens by hand.
- **Starts from:** session 7 committed.
- **Ends with:** A14, A15 pass; the user has the hand-check list for A1–A13; the plan directory is deleted.
- **Owns:** `documents/`, plus the mechanical fixes `finish` makes anywhere in the plan's diff.

Runs alone.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 8.1 | Finish | — | `finish` skill on everything the plan touched | judgment findings fixed | [ ] |
| 8.2 | Ideas doc | task | main thread | `ideas/spaces.md` lists only what is unbuilt | [ ] |
| 8.3 | Hand-check list | task | main thread | list sent to the user | [ ] |
| 8.4 | Check, commit, delete plan | — | `check`, `git commit`, delete `documents/plans/spaces/` | gate passes | [ ] |

## 8.1 — Finish

Run `finish` on the diff since the plan's first commit. Expected doc updates: `documents/apps/vscode.md` and the browser app doc (the sidebar sections, the Spaces commands and the right pane), `documents/product.md` (a Space in product terms, if product.md covers surfaces), `documents/contracts/spaces.md` against the code. No stub mounts left from session 4.

## 8.2 — Ideas doc

Edit `documents/ideas/spaces.md`: remove what is now documented in `documents/` and link to it; keep Notes, Discussions, Discover, Research chat, Sharing, Glossary suggestions, avatars and Insert from LabShelf as the idea for later plans. The mockup stays.

## 8.3 — Hand-check list

Send the user A1–A13 as steps for VS Code (extension host) and the browser, with how to run each app from `documents/apps/README.md#verifying-changes`. Do not run `verify` unless asked.

## 8.4 — Check, commit, delete plan

`pnpm -r typecheck` and `pnpm -r test` (A15). Commit the docs, then delete `documents/plans/spaces/` in its own commit.
