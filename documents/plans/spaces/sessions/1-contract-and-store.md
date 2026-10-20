# Session 1 — Contract, model and store

- **Goal:** Spaces have a documented on-disk contract, a core model and a store that changes them safely.
- **Starts from:** plan approved; no `spaces` code in `packages/`.
- **Ends with:** the contract, `core/src/spaces/{model,store}/` with tests, Space conflict copies in the library scan (A12; the format behind A1–A5, A9, A11).
- **Owns:** `documents/contracts/{spaces,library-format}.md`, `packages/core/src/spaces/{model,store,index.ts}`, `packages/core/src/library/{layout.ts,conflicts/}`, `packages/core/src/writing/merge/node/libraryConflictScan.ts`, the `ConflictOwner.kind` labels in apps, their tests.

Runs alone. Codebase facts for briefs: [research/codebase-core.md](../research/codebase-core.md). The decided format: [research/format.md](../research/format.md).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1.1 | Write the contract | contract | main thread | doc exists, hook clean | [ ] |
| 1.2 | Model: types, parse, serialize | contract | implementer (opus) | tests pass | [ ] |
| 1.3 | Store and mutations | behaviour | implementer (sonnet) | tests pass | [ ] |
| 1.4 | Conflict copies of Space files | contract | implementer (sonnet), then `architecture-reviewer` | tests pass, review clean | [ ] |
| 1.5 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

1.3 and 1.4 run in parallel after 1.2.

## 1.1 — Write the contract

- **Goal:** `documents/contracts/spaces.md` states `research/format.md`; `library-format.md` lists `spaces/`.
- **Read only:** `research/format.md`; `documents/contracts/library-format.md:1-30`, `:296-316`; `documents/contracts/sync.md`.
- **Decided:** sections Layout, `space.json`, `glossary.json`, Ids, Reading, Writing, Conflict copies. One row in the Layout block of `library-format.md`; one bullet in its Conflict copies list pointing to `spaces.md#conflict-copies`. AGENTS.md §5.
- **Done when:** `check-rules.sh` reports nothing.
- **Do not touch:** code.

## 1.2 — Model: types, parse, serialize

- **Goal:** runtime-neutral types and parse/serialize for both files, plus the id slug rule.
- **Read only:** `documents/contracts/spaces.md`; `packages/core/src/writing/checklist/checklistFile.ts:1-100` (shape to copy); `packages/core/src/model/paperStatus.ts:1-17`; `packages/core/src/library/layout.ts:1-50`; AGENTS.md §3.
- **Decided:** `packages/core/src/spaces/model/` with `index.ts`, one file per responsibility (types, parse, serialize, glossary file, id slug). `SPACES_DIR`, `SPACE_FILE`, `GLOSSARY_FILE` go in `library/layout.ts` and `libraryLayout`. `spaces/index.ts` is the public API.
- **Done when:** tests in `packages/core/__tests__/spaces/model/`, seen failing first: round-trip keeps unknown keys at both levels; missing folder reads as root; parent cycle; duplicate paper id keeps the first; invalid entries dropped; unreadable file gives the `unreadable` state; version 2 is read-only; slug rules (accents, empty, collision suffix). Core typecheck and test pass.
- **Do not touch:** other domains.

## 1.3 — Store and mutations

- **Goal:** list, read and change Spaces through `LibraryFileSystem`, with logging and change notification.
- **Read only:** `packages/core/src/spaces/model/index.ts`; `research/store-api.md`; `packages/core/src/library/mutations/context.ts:19-30`; `library/mutations/folderOps.ts`; `library/model/libraryStore.ts:1-80`; `ports/libraryFileSystem.ts`.
- **Decided:** the API in `research/store-api.md`, under `packages/core/src/spaces/store/`.
- **Done when:** tests in `packages/core/__tests__/spaces/store/` over an in-memory `LibraryFileSystem` (reuse a core test fake if one exists), seen failing first: one name twice gives two ids; addPapers is idempotent; deleting a folder moves its references up; delete calls `trash`; unknown keys survive every mutation; an outside write between read and write keeps the fields the mutation does not touch; `onChange` fires once per mutation. Core typecheck and test pass.
- **Do not touch:** `spaces/model/` beyond exports.

## 1.4 — Conflict copies of Space files

- **Goal:** the library conflict scan lists conflict copies of `space.json` and `glossary.json`.
- **Read only:** `packages/core/src/library/conflicts/conflictCopy.ts:1-25`, `conflictNames.ts`, `node/conflictScan.ts:1-36`, `node/conflictResolution.ts:1-54`; `packages/core/src/writing/merge/node/libraryConflictScan.ts:1-26`; `documents/contracts/spaces.md#conflict-copies`.
- **Decided:** `ConflictOwner` gains `{ kind: "space"; id }`. New `library/conflicts/node/spaceConflictScan.ts` lists copies directly inside `spaces/<id>/`, hidden names skipped; `libraryConflictScan.ts` includes it. `conflictResolutions` gives keepMine and keepOther for both Space files. Every switch or label on `owner.kind` in `packages/*/src` gets the `space` case, labelled "Space".
- **Done when:** tests first: a Syncthing and a Dropbox copy of `space.json` are found with owner `space`; a nested copy is ignored; no keepBoth. `pnpm -r typecheck` passes. Then `architecture-reviewer` on the 1.2–1.4 diff against the contract.
- **Do not touch:** sidecar and project merge logic.

## 1.5 — Check, commit

`check` on Owns. Commit: `Add the Spaces format, model and store`.
