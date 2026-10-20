# Session 1 — Prove browser authentication and shared-folder ownership

- **Goal:** Prove the browser callback route and exclusive disk-mirror ownership before choosing their adapters.
- **Starts from:** Plan available; implementation is not part of this session.
- **Ends with:** A concrete OAuth route for Chrome/Firefox and a crash-safe same-folder ownership design, with evidence and explicit external prerequisites.
- **Owns:** `documents/plans/browser-sharing-parity/research/`, this session, isolated scratch fixtures; no production source or external account configuration changes. Matching tests and public barrels are included. Preserve unrelated working-tree edits.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1.1 | Deliver the brief | task | main thread | Ends with above | [ ] |
| 1.2 | Review and checks | task | main thread; architecture review for sync/formats | Evidence recorded | [ ] |

## 1.1 — Work package

Read the applicable repository rules and the contracts named below. This session is self-contained; do not read other session files or log.md. Production adapters are instantiated only in composition roots. Neutral core imports neither Node nor DOM nor app APIs. DOM components use core tokens/icons; apps never import each other. Keep source files under 200 lines where possible, never over 300, functions at most 50 lines, tests at most 500 lines and at most eight direct source files per directory; expose public indexes.

### Read only

- `documents/plans/browser-sharing-parity/research/feasibility.md` (technical gate evidence)
- `packages/core/src/relay/deploy/oauth/authorizationRequest.ts:1–43`
- `packages/core/src/relay/deploy/oauth/oauthClient.ts:1–15`
- `packages/vscode/src/relay/signIn/loopbackCallback.ts:1–81`
- `packages/browser/manifest.chrome.json:1–75`
- `packages/browser/manifest.firefox.json:1–91`
- `packages/browser/src/storage/libraryFileSystem.ts:1–217`
- `packages/core/src/collab/node/mirror/projectMirror.ts:1–129`

### Decided work

1. Verify current provider and WebExtension documentation at execution time. Prove authorization, exact registered redirect, PKCE/state binding, token exchange and refresh in isolated Chrome and Firefox profiles. Check token endpoint access and callback lifetime through MV3 suspension. Use existing public client registration where supported; record any required registration change for the account owner. Do not silently replace sign-in with token entry.
2. Prove an exclusive mirror lease across two browser tabs and across browser/VS Code using the same physical project. Prefer existing lock facilities; inspect their stale-owner, heartbeat and crash rules. A browser-only lock cannot protect a native mirror. Define contention, owner death, handoff and queued-write handling; retain edit buffers during handoff.
3. For picked-folder/bridge roots, choose the minimum adapter or narrowly scoped native operation needed to participate in the same ownership mechanism. Keep filesystem coordination distinct from share identity: different local copies of a share can connect simultaneously. No second collaboration engine in the helper.
4. Record decisions, commands, supported storage/browser combinations and unresolved gates in research/feasibility.md. Update dependent session briefs with the proved choices. If an external registration is required, prepare the exact configuration; do not claim a successful real sign-in until it runs.

### Verification

Protocol/credential/ownership proofs only. No production test suite is needed for documentation; retain reproducible sanitized scratch commands. A failed technical proof blocks its dependent feature, not independent state/mirror work.

Use tests under `packages/<pkg>/__tests__/` mirroring source. Add failing regression coverage before logic, format, sync or data-loss changes. Run `pnpm --filter @labshelf/<pkg> typecheck` and `pnpm --filter @labshelf/<pkg> test` for every touched package, including core when touched. Run relevant builds for runtime/build changes. Delete replaced implementations and unused imports/exports/tests in the same change; no old-path re-exports. Update affected durable contracts/docs in the same session. Never run `verify` unless the user requests it. Finish with what remains unchecked.

### Do not touch

Unrelated product features, the user's actual library, credentials in committed evidence, and external resources not created by an explicitly authorized run. Do not mark a real-runtime acceptance passed based only on mocks. No automatic commits or deployments are part of this brief.
