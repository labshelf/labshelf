# Session 3 — Conflict copies recognised by content

- **Goal:** LabShelf offers any new project text file that is a version of another file for merging, whatever name the sync tool gave it. In a shared project, such a file is not shared until the user decides.
- **Starts from:** session 2b committed.
- **Ends with:** A6, A7 pass; `sync.md` and `library-format.md` describe the detection and the choices.
- **Owns:**
  - core `packages/core/src/library/conflicts/`, `packages/core/src/writing/merge/node/` and the collab mirror's untracked-file path (`packages/core/src/collab/mirror/reconcile/untrackedFile.ts`), with their tests;
  - VS Code `packages/vscode/src/library/conflicts/` and its tests;
  - terminal `packages/terminal/src/ui/app/conflicts/` and `packages/terminal/src/cli/setup/conflictsCommand.ts`, with their tests;
  - `documents/contracts/{sync,library-format}.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Core detector and resolutions | contract | implementer (opus) | tests below | [ ] |
| 3.2 | Held back from the share | contract | implementer (sonnet) | A7 | [ ] |
| 3.3 | VS Code and terminal prompt | behaviour | implementer (sonnet) | A6 by hand | [ ] |
| 3.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 3.1 — Core detector and resolutions

- **Goal:** Find "X looks like a version of Y" by name pattern, recorded hash or line similarity, and resolve it.
- **Read only:**
  - `documents/plans/stale-copies/research/library-conflicts.md`
  - `packages/core/src/library/conflicts/conflictNames.ts`
  - `packages/core/src/library/conflicts/conflictCopy.ts`
  - `packages/core/src/library/conflicts/node/conflictResolution.ts`
  - `packages/core/src/writing/merge/node/projectConflictScan.ts`
  - `packages/core/src/writing/merge/node/projectCopyMerge.ts`
  - `packages/core/src/library/writeRecords/index.ts`
  - the `lineSimilarity` file from session 1
- **Decided:**
  - **Scope.** Detection runs inside project folders only (paper folders keep today's name rules), on text files that pass `mergeableTextFile`.
  - **Match order:**
    1. A known name pattern (today).
    2. The file's hash is a recorded version of a sibling project file Y (`readWriteRecords`).
    3. Same extension, and `lineSimilarity(X, Y) >= 0.6` (constant `VERSION_SIMILARITY`), picking the most similar Y.
  - **What is skipped.** Files LabShelf creates itself (`(copy N)` from keep both, `.labshelf/`, build output). Paths the user dismissed: a device-local list of `{path, hash}`, stored next to the merge-base store.
  - **`ConflictCopy`** gains `match: "name" | "record" | "similar"`. For `record` and `similar`, `tool` is `"unknown"`.
  - **Resolutions for a content match:**
    - `mergeAutomatically`: three-way merge, with the base being the stored version of Y most similar to X; it falls back to the existing copy merge when there is none. Write atomically, delete X, store and record.
    - `notAVersion`: remember the dismissal.
    - The "merge myself" choice is app glue (3.3); it opens both files and changes nothing in core.
  - A name-pattern match keeps today's automatic merge and choices.
  - **Contract.** `sync.md` "Conflict copies" describes detection by content and the choices. The conflict-name table in `library-format.md` says a copy with an unknown name is found by content.
- **Done when:**
  - The failing tests come first:
    - `main (1).tex` with 80% equal lines is found as a version of `main.tex`;
    - a new chapter with 10% equal lines is not;
    - a recorded hash is found whatever its similarity;
    - a dismissed path is not offered again until its content changes;
    - `mergeAutomatically` merges and removes the copy.
  - The core tests and typecheck pass.
- **Do not touch:** UI code (3.3).

## 3.2 — Held back from the share

- **Goal:** In a shared project, a new file that the 3.1 detector matches is not added to the share until it is resolved (D8, D10).
- **Read only:**
  - `packages/core/src/collab/mirror/reconcile/untrackedFile.ts`
  - `packages/core/src/collab/mirror/projectMirror.ts:133-155`
  - the 3.1 detector's index
  - `packages/core/__tests__/collab/mirror/mirrorFixture.ts`
- **Decided:**
  - `reconcileUntracked` asks the detector first. On a match it logs INFO, leaves the file out of `files`, and reports it through the mirror's existing problem or report channel, so the app shows the 3.3 prompt.
  - After `mergeAutomatically`, the merged text enters through the normal reconcile of Y. A dismissal adds the file to the share as today.
  - The project conflict scan (`projectConflictScan.ts`) skips projects whose settings have `shared`.
- **Done when:**
  - The failing test comes first: A7, a `main (1).tex` similar copy in a shared project does not reach the peer, and after dismissal it does.
  - The collab suites pass.
- **Do not touch:** the detector internals.

## 3.3 — VS Code and terminal prompt

- **Goal:** Show the content-match question and its three choices.
- **Read only:**
  - `packages/vscode/src/library/conflicts/conflictNotifier.ts`
  - `packages/vscode/src/library/conflicts/conflictChoices.ts`
  - `packages/vscode/src/library/conflicts/conflictWalk.ts`
  - `packages/terminal/src/ui/app/conflicts/conflictOverlay.ts`
  - `documents/product.md` (vocabulary)
- **Decided:**
  - **Text.** "<X> appeared in <project> and looks like a version of <Y>." Choices: "Merge Automatically", "Merge Myself", "Not a Version".
  - **VS Code.** "Merge Myself" opens `vscode.diff` of Y and X. The copy stays until the user deletes it or picks again.
  - **Terminal.** "Merge Myself" prints both paths and leaves them.
  - Name-pattern copies keep today's choices.
- **Done when:** the vscode and terminal tests for the choice lists pass. The look and the flow are checked by hand (no UI test).
- **Do not touch:** core.
