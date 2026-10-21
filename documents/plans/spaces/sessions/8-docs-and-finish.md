# Session 8 — Docs, finish and hand check

- **Goal:** the docs describe Spaces as built, the whole change passes the finishing pass, and the user checks the screens by hand.
- **Starts from:** Spaces documentation and persistence corrections committed as `0c353e0f`; the final gate has the findings below.
- **Ends with:** A14, A15 pass; the user has the hand-check list for A1–A13; the plan directory is deleted.
- **Owns:** `documents/`, plus the mechanical fixes `finish` makes anywhere in the plan's diff.

Runs alone.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 8.1 | Finish | — | `finish` skill on everything the plan touched | judgment findings fixed | [x] |
| 8.2 | Ideas doc | task | main thread | `ideas/spaces.md` lists only what is unbuilt | [x] |
| 8.3 | Hand-check list | task | main thread | list sent to the user | [x] |
| 8.4 | Check, commit, delete plan | — | `check`, `git commit`, delete `documents/plans/spaces/` | gate passes | [ ] |

## 8.1 — Finish

The finishing pass is complete. Shared project-checklist computation lives in core; glossary filesystem failures return an empty read-only result with diagnostics; Space creation reserves folders appearing after the directory listing. Regression tests cover both persistence boundaries. Do not repeat the finishing pass without further source changes. The review scope is the Spaces implementation commits starting at `599404f6`. Expected doc updates: `documents/apps/vscode.md` and the browser app doc (the sidebar sections, the Spaces commands and the right pane), `documents/product.md` (a Space in product terms, if product.md covers surfaces), `documents/contracts/spaces.md` against the code. No stub mounts left from session 4.

## 8.2 — Ideas doc

Edit `documents/ideas/spaces.md`: remove what is now documented in `documents/` and link to it; keep Notes, Discussions, Discover, Research chat, Sharing, Glossary suggestions, avatars and Insert from LabShelf as the idea for later plans. The mockup stays.

## 8.3 — Hand-check list

The shared checklist at [apps/spaces.md](../../../apps/spaces.md) supplies A1–A14, host startup and isolation instructions. The user performs the visual checks in both apps. Do not run `verify` unless asked.

## 8.4 — Check, commit, delete plan

`pnpm -r typecheck` and `pnpm -r test` (A15). Commit the docs, then delete `documents/plans/spaces/` in its own commit.

## Gate findings and remaining work

A15 is unmet. All-package typecheck passes. Full suites report 9,185 passing tests and one failure; the Spaces subset passes 23 suites / 218 tests. The failing assertion reproduces in isolation at `packages/core/__tests__/collab/relays/relayOutage.test.ts:68`: it expects at least four retry gaps and receives zero. That test and relay source have no changes in this session. Relay retry behaviour requires its own diagnosis and regression fix; it is outside the mechanical finishing scope.

Whole-package lint reports 10 core and six browser function-length violations outside the files changed in this session. Lint and size/shape checks on touched files pass. Knip and jscpd report repository findings outside Spaces after its entrypoints and unused exports are addressed. Core and browser report worker teardown leaks; the independent app-suite runs use `--maxWorkers=2 --forceExit`.

Remaining: resolve the relay failure in a separately scoped change, then rerun `pnpm -r typecheck` and `pnpm -r test` and the check gate. Preserve this directory while the gate fails. Once the gate passes, finish 8.4 and delete this directory in its own commit. A14 visual acceptance and A1–A13 host checks remain with the user; `verify` is not requested.
