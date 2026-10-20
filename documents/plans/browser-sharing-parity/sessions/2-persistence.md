# Session 2 — Share durable collaboration state across runtimes

- **Goal:** Put state contracts in neutral core and add IndexedDB persistence without changing Node user data.
- **Starts from:** Session 1 records the library identity and ownership choices.
- **Ends with:** A4/A11 persistence cases pass in core and browser; VS Code consumes the state port.
- **Owns:** `packages/core/src/collab/state/`, `packages/core/src/collab/node/state/`, `packages/browser/src/storage/collaboration/`, `packages/browser/src/library-page/editor/collab/shareKeyStore.ts`, VS Code session state wiring, `documents/contracts/collaboration.md`, `documents/contracts/library-format.md`. Matching tests and public barrels are included. Preserve unrelated working-tree edits.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | Deliver the brief | contract | implementer; tests first for behavior/contracts | Ends with above | [ ] |
| 2.2 | Review and checks | task | main thread; architecture review for sync/formats | Evidence recorded | [ ] |

## 2.1 — Work package

Read the applicable repository rules and the contracts named below. This session is self-contained; do not read other session files or log.md. Production adapters are instantiated only in composition roots. Neutral core imports neither Node nor DOM nor app APIs. DOM components use core tokens/icons; apps never import each other. Keep source files under 200 lines where possible, never over 300, functions at most 50 lines, tests at most 500 lines and at most eight direct source files per directory; expose public indexes.

### Read only

- `documents/plans/browser-sharing-parity/research/feasibility.md` (technical gate evidence)
- `packages/core/src/collab/node/state/collabStore.ts:1–108`
- `packages/core/src/collab/node/state/docLog.ts:1–55`
- `packages/core/src/collab/node/state/blobCache.ts:1–31`
- `packages/core/src/collab/sync/relay/relayCursors.ts:1–12`
- `packages/browser/src/library-page/editor/collab/shareKeyStore.ts:1–65`
- `packages/browser/src/storage/indexedDbFileSystem.ts:1–77`
- `packages/core/__tests__/collab/node/state/collabStore.test.ts:1–116`

### Decided work

1. Define the minimum neutral state interfaces from session/mirror consumption: hydrated doc creation, update durability, blob cache, agreed hashes, relay cursors and flush/close. Keep Yjs update ordering and recovery decisions common; filesystem encoding lives in node/, IndexedDB transactions live in browser/.
2. Hydrate persisted docs before creating a session, retaining the synchronous doc factory used by core. Couple cursor advancement to successful persistence of the covered updates. Preserve the Node snapshot/log format and torn-tail recovery. Do not swallow a failed write and then save a later cursor.
3. Namespace browser state by stable storage-source/library identity plus share id. Keep it outside synced library files. Preserve existing stored invites/keys through a tested browser migration under migrations/, with its deletion condition in the header; associate entries with verified project/library identity, never infer the target library solely from the currently open tab. Do not add compatibility aliases.
4. Browser credentials use extension-local storage inaccessible to content scripts where the platform supports access restriction; otherwise expose only narrow validated background operations. Never use sync storage or log secrets. Handle quota, corrupt records, transaction abort and library removal without overwriting recoverable state.

### Verification

Test hydration after restart, duplicate updates, torn Node log, failed IndexedDB writes, cursor ordering, blob integrity, namespace separation and invite migration. Run core/browser/vscode typecheck and tests; check file/function/directory limits and update the contracts in this session.

Use tests under `packages/<pkg>/__tests__/` mirroring source. Add failing regression coverage before logic, format, sync or data-loss changes. Run `pnpm --filter @labshelf/<pkg> typecheck` and `pnpm --filter @labshelf/<pkg> test` for every touched package, including core when touched. Run relevant builds for runtime/build changes. Delete replaced implementations and unused imports/exports/tests in the same change; no old-path re-exports. Update affected durable contracts/docs in the same session. Never run `verify` unless the user requests it. Finish with what remains unchecked.

### Do not touch

Unrelated product features, the user's actual library, credentials in committed evidence, and external resources not created by an explicitly authorized run. Do not mark a real-runtime acceptance passed based only on mocks. No automatic commits or deployments are part of this brief.
