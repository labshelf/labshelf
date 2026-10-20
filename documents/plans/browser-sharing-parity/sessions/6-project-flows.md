# Session 6 — Share project lifecycle and editor mutations

- **Goal:** Create, join, resume and leave projects through the same core workflows in both apps.
- **Starts from:** Sessions 2–5 supply durable sessions, mirrors and relay accounts.
- **Ends with:** A1/A2/A3 lifecycle and editing cases pass without silent local-only fallback.
- **Owns:** `packages/core/src/collab/share/`, shared lifecycle/comments modules, VS Code collab commands/ownRelay/resumeShares, browser collab/projectWiring/source/session/review integration, affected project/collaboration contracts. Matching tests and public barrels are included. Preserve unrelated working-tree edits.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 6.1 | Deliver the brief | contract | implementer; tests first for behavior/contracts | Ends with above | [ ] |
| 6.2 | Review and checks | task | main thread; architecture review for sync/formats | Evidence recorded | [ ] |

## 6.1 — Work package

Read the applicable repository rules and the contracts named below. This session is self-contained; do not read other session files or log.md. Production adapters are instantiated only in composition roots. Neutral core imports neither Node nor DOM nor app APIs. DOM components use core tokens/icons; apps never import each other. Keep source files under 200 lines where possible, never over 300, functions at most 50 lines, tests at most 500 lines and at most eight direct source files per directory; expose public indexes.

### Read only

- `documents/plans/browser-sharing-parity/research/feasibility.md` (technical gate evidence)
- `packages/vscode/src/collab/node/commands/shareCommand.ts:1–78`
- `packages/vscode/src/collab/node/commands/joinCommand.ts:1–94`
- `packages/vscode/src/collab/node/commands/leaveCommand.ts:1–48`
- `packages/vscode/src/collab/node/ownRelay.ts:1–66`
- `packages/browser/src/library-page/editor/collab/pageShares.ts:1–86`
- `packages/browser/src/library-page/editor/collab/joinSharedProject.ts:1–76`
- `packages/browser/src/library-page/tabs/source/index.ts:1–99`
- `packages/browser/src/library-page/tabs/source/actions/insertImage.ts:1–54`

### Decided work

1. Extract share/join/resume/leave orchestration over project catalog, key store, relay account and shared sessions. Keep user choices/cancellation in hosts. Connect a relay before publishing an invite; cancellation rolls back only work owned by the operation. Re-copy invite from current keys/relay list. Joining validates kind/path/invite before creating user content.
2. Both hosts wire these workflows; browser can originate shares without VS Code. Leave retains files, releases session ownership and removes this device association after required flushes; other users retain access. Preserve errors and local work if a flush fails.
3. Keep VS Code text binding and browser CodeMirror binding as adapters. Reuse relative positions, colors, undo rules and comment model from core; move any reusable comment lifecycle out of browser/vscode into core. Test own-only undo with mixed remote edits.
4. Route image insertion, file create/rename/delete, history restore and shared settings through the common session/mirror. Update helper unsaved buffers when remote text changes to avoid compiling stale text. Remove the browser image-not-shared limitation and silent local-edit fallback only when replacement paths pass tests; a disconnected session remains editable with durable Yjs state, a failed session startup is visibly unresolved.

### Verification

Test browser-origin and VS Code-origin invite round trips, repeat join/resume, missing keys, cancellation rollback, leave failure, undo, comments, images, history and compile buffer freshness. Run core/browser/vscode typecheck/tests and affected builds; update contracts/docs and check size/shape.

Use tests under `packages/<pkg>/__tests__/` mirroring source. Add failing regression coverage before logic, format, sync or data-loss changes. Run `pnpm --filter @labshelf/<pkg> typecheck` and `pnpm --filter @labshelf/<pkg> test` for every touched package, including core when touched. Run relevant builds for runtime/build changes. Delete replaced implementations and unused imports/exports/tests in the same change; no old-path re-exports. Update affected durable contracts/docs in the same session. Never run `verify` unless the user requests it. Finish with what remains unchecked.

### Do not touch

Unrelated product features, the user's actual library, credentials in committed evidence, and external resources not created by an explicitly authorized run. Do not mark a real-runtime acceptance passed based only on mocks. No automatic commits or deployments are part of this brief.
