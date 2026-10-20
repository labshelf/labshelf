# Session 3 — Reuse one bidirectional project mirror

- **Goal:** Run the existing reconciliation rules over shared filesystem ports in both apps.
- **Starts from:** Session 2 state ports exist; session 1 specifies ownership and external-change observation.
- **Ends with:** A3/A7/A10 mirror cases pass over Node and browser adapters.
- **Owns:** `packages/core/src/collab/mirror/`, `packages/core/src/collab/node/mirror/`, browser storage notification/ownership adapters, VS Code mirror wiring, `documents/contracts/collaboration.md`, `documents/contracts/bridge.md` only if a narrow operation is necessary. Matching tests and public barrels are included. Preserve unrelated working-tree edits.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Deliver the brief | contract | implementer; tests first for behavior/contracts | Ends with above | [ ] |
| 3.2 | Review and checks | task | main thread; architecture review for sync/formats | Evidence recorded | [ ] |

## 3.1 — Work package

Read the applicable repository rules and the contracts named below. This session is self-contained; do not read other session files or log.md. Production adapters are instantiated only in composition roots. Neutral core imports neither Node nor DOM nor app APIs. DOM components use core tokens/icons; apps never import each other. Keep source files under 200 lines where possible, never over 300, functions at most 50 lines, tests at most 500 lines and at most eight direct source files per directory; expose public indexes.

### Read only

- `documents/plans/browser-sharing-parity/research/feasibility.md` (technical gate evidence)
- `packages/core/src/collab/node/mirror/projectMirror.ts:1–129`
- `packages/core/src/collab/node/mirror/mirrorContext.ts:1–55`
- `packages/core/src/collab/node/mirror/textMirror.ts:1–61`
- `packages/core/src/collab/node/mirror/blobMirror.ts:1–56`
- `packages/core/src/collab/node/mirror/settingsMirror.ts:1–44`
- `packages/core/src/ports/libraryFileSystem.ts:1–15`
- `packages/browser/src/storage/libraryFileSystem.ts:1–217`
- `packages/core/__tests__/collab/node/mirror/twoMirrors.test.ts:1–66`

### Decided work

1. Extract reconciliation, path queue and conflict decisions into neutral core using existing filesystem/path/read ports. Keep recursive fs.watch, symlink-safe platform operations and native stable reads in node/. Inject subscriptions or changed(path); supplement browser notifications with bounded scans on resume/visibility and while shared projects are active where a storage source cannot notify external changes.
2. Preserve safe-path checks, atomic writes, exclusion rules, editor-owned file handling, settings locality, agreed hashes and comment/bibliography rules. A missing/permission-denied root is not a remote delete. Concurrent deletion and edits keep recoverable content under the existing conflict policy.
3. Implement the proved ownership adapter for tabs and physical folders. Acquire before scanning or writing, renew while owned and stop queued writes on loss. Separate storage roots and separate library copies can mirror concurrently. Native protocol additions require parsers, version behavior and matching terminal/helper tests if that package is touched.
4. Switch VS Code to the neutral engine in this session; keep node/ as adapters with one implementation of each reconciliation rule. Connect all three browser storage sources. The browser text-only writer is removed when the session consumer switches in session 4, with its tests replaced by adapter coverage.

### Verification

Test both adapters against the same reconciliation cases: external edits, text/blob changes, rename/delete conflicts, settings, path traversal, symlinks through disk adapters, interrupted writes, permission loss, event echoes and lease loss. Run core/browser/vscode typecheck/tests and terminal checks if touched; update affected contracts and check size/shape.

Use tests under `packages/<pkg>/__tests__/` mirroring source. Add failing regression coverage before logic, format, sync or data-loss changes. Run `pnpm --filter @labshelf/<pkg> typecheck` and `pnpm --filter @labshelf/<pkg> test` for every touched package, including core when touched. Run relevant builds for runtime/build changes. Delete replaced implementations and unused imports/exports/tests in the same change; no old-path re-exports. Update affected durable contracts/docs in the same session. Never run `verify` unless the user requests it. Finish with what remains unchecked.

### Do not touch

Unrelated product features, the user's actual library, credentials in committed evidence, and external resources not created by an explicitly authorized run. Do not mark a real-runtime acceptance passed based only on mocks. No automatic commits or deployments are part of this brief.
