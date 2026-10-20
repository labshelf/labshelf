# Session 4 — Unify connection and relay orchestration

- **Goal:** Give both apps the same persistent session, blob exchange and relay failover lifecycle.
- **Starts from:** Sessions 2–3 provide state and mirror ports/adapters.
- **Ends with:** A4/A5 pass with browser and VS Code consumers of one connection implementation.
- **Owns:** `packages/core/src/collab/session/`, `packages/core/src/collab/relays/`, VS Code `collab/node/session/`, browser `library-page/editor/collab/` connection/pageShares/docFileWriter wiring, `documents/contracts/collaboration.md`. Matching tests and public barrels are included. Preserve unrelated working-tree edits.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4.1 | Deliver the brief | contract | implementer; tests first for behavior/contracts | Ends with above | [ ] |
| 4.2 | Review and checks | task | main thread; architecture review for sync/formats | Evidence recorded | [ ] |

## 4.1 — Work package

Read the applicable repository rules and the contracts named below. This session is self-contained; do not read other session files or log.md. Production adapters are instantiated only in composition roots. Neutral core imports neither Node nor DOM nor app APIs. DOM components use core tokens/icons; apps never import each other. Keep source files under 200 lines where possible, never over 300, functions at most 50 lines, tests at most 500 lines and at most eight direct source files per directory; expose public indexes.

### Read only

- `documents/plans/browser-sharing-parity/research/feasibility.md` (technical gate evidence)
- `packages/vscode/src/collab/node/session/shareConnection.ts:1–147`
- `packages/vscode/src/collab/node/session/shareRelays.ts:1–66`
- `packages/vscode/src/collab/node/session/activeShares.ts:1–63`
- `packages/browser/src/library-page/editor/collab/shareConnection.ts:1–49`
- `packages/browser/src/library-page/editor/collab/pageShares.ts:1–86`
- `packages/browser/src/library-page/editor/collab/docFileWriter.ts:1–109`
- `packages/core/src/collab/sync/shareSession.ts:1–74`
- `packages/core/__tests__/collab/relays/relayFailover.test.ts:1–77`

### Decided work

1. Move reusable connection orchestration and followShareRelays into neutral core. Inject hydrated state, project context, mirror factory and logger; reuse attachBlobs, switchable transport, relay selection/watch and single snapshot-writer election. Keep actual storage/watching instantiation in composition roots.
2. Both consumers use the same startup/rollback/close ordering. Close flushes durable state; partial startup releases ownership, transport and subscriptions. Session state exposes connection and persistence failures to UI without complete invites in logs.
3. Browser page lifecycle acquires the session lease, resumes after ownership handoff and restores state after owner death. Do not depend on pagehide awaiting asynchronous writes: commit updates during editing and document the persistence acknowledgment boundary. Closing all library pages ends connectivity without dropping acknowledged edits.
4. Remove the browser first-relay-only connection and text-only writer when their consumers switch. Remove stale tests/exports; preserve comments through the common mirror or a shared comments synchronizer. Reconnecting uses stored state and per-relay cursors, not a fresh doc seeded blindly from files.

### Verification

Test partial startup cleanup, repeated resume, pending persistence on close, interrupted page lifetime, two-tab handoff, first-relay failure, fresh-socket refusal with existing peers and single snapshot writer. Run core/browser/vscode typecheck/tests and relevant builds; update lifecycle contract and check size/shape.

Use tests under `packages/<pkg>/__tests__/` mirroring source. Add failing regression coverage before logic, format, sync or data-loss changes. Run `pnpm --filter @labshelf/<pkg> typecheck` and `pnpm --filter @labshelf/<pkg> test` for every touched package, including core when touched. Run relevant builds for runtime/build changes. Delete replaced implementations and unused imports/exports/tests in the same change; no old-path re-exports. Update affected durable contracts/docs in the same session. Never run `verify` unless the user requests it. Finish with what remains unchecked.

### Do not touch

Unrelated product features, the user's actual library, credentials in committed evidence, and external resources not created by an explicitly authorized run. Do not mark a real-runtime acceptance passed based only on mocks. No automatic commits or deployments are part of this brief.
