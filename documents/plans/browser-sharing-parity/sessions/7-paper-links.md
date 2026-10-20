# Session 7 — Reuse paper-folder sharing workflows

- **Goal:** Create, manage, import and revoke paper links from both apps through one core workflow.
- **Starts from:** Session 5 provides relay credentials; storage adapters are available.
- **Ends with:** A8 passes with both registries and the public share format.
- **Owns:** `packages/core/src/share/`, `packages/vscode/src/share/`, `packages/browser/src/share/`, browser registry and library host wiring, `documents/contracts/share-link.md`. Matching tests and public barrels are included. Preserve unrelated working-tree edits.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 7.1 | Deliver the brief | contract | implementer; tests first for behavior/contracts | Ends with above | [ ] |
| 7.2 | Review and checks | task | main thread; architecture review for sync/formats | Evidence recorded | [ ] |

## 7.1 — Work package

Read the applicable repository rules and the contracts named below. This session is self-contained; do not read other session files or log.md. Production adapters are instantiated only in composition roots. Neutral core imports neither Node nor DOM nor app APIs. DOM components use core tokens/icons; apps never import each other. Keep source files under 200 lines where possible, never over 300, functions at most 50 lines, tests at most 500 lines and at most eight direct source files per directory; expose public indexes.

### Read only

- `documents/plans/browser-sharing-parity/research/feasibility.md` (technical gate evidence)
- `packages/vscode/src/share/folderSharePapers.ts:1–45`
- `packages/vscode/src/share/node/shareFolderCommand.ts:1–73`
- `packages/vscode/src/share/node/manageSharesCommand.ts:1–70`
- `packages/vscode/src/share/node/importShareCommand.ts:1–69`
- `packages/core/src/share/shareRegistry.ts:1–58`
- `packages/core/src/share/uploadShare.ts:1–54`
- `packages/core/src/share/revokeShare.ts:1–36`
- `packages/core/src/share/importSharedPapers.ts:1–85`

### Decided work

1. Move folder eligibility, recursive paper selection and paper input reads to core/share using existing filesystem/path/annotation ports. Both apps consume it; delete the app-owned reusable implementation and update all importers/tests through public barrels.
2. Extract common workflow decisions around existing build/upload/open/import/revoke functions. Retain manifest-last publication, registry-before-upload and retryable revoke. Browser implements transactional ShareRegistryStore scoped to the source/library; malformed data is preserved for recovery.
3. Add browser operations for create, list/copy, revoke and import. Present annotation choice, rights notice, progress, duplicates and missing PDFs with the same meaning as VS Code. Do not introduce annotation import or whole-library live sync as hidden scope.
4. Accept pasted share links through the existing parser. Library UI offers browser import without requiring vscode:// routing; public website openers stay compatible. Extend website/browser routing only if required for a browser-target opener, with an explicit contract and tests.

### Verification

Test nested-folder eligibility, inputs with/without annotations, interrupted upload/revoke after restart, malformed registry, concurrent registry mutations, duplicate import and damaged PDF. Reuse crypto/format tests. Run core/browser/vscode typecheck/tests/builds; test/build website only if touched; update contract and check size/shape.

Use tests under `packages/<pkg>/__tests__/` mirroring source. Add failing regression coverage before logic, format, sync or data-loss changes. Run `pnpm --filter @labshelf/<pkg> typecheck` and `pnpm --filter @labshelf/<pkg> test` for every touched package, including core when touched. Run relevant builds for runtime/build changes. Delete replaced implementations and unused imports/exports/tests in the same change; no old-path re-exports. Update affected durable contracts/docs in the same session. Never run `verify` unless the user requests it. Finish with what remains unchecked.

### Do not touch

Unrelated product features, the user's actual library, credentials in committed evidence, and external resources not created by an explicitly authorized run. Do not mark a real-runtime acceptance passed based only on mocks. No automatic commits or deployments are part of this brief.
