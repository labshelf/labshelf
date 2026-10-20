# Session 5 — Share Cloudflare account lifecycle with a browser adapter

- **Goal:** Connect Cloudflare in the browser using the proved callback and the same refresh/deploy logic as VS Code.
- **Starts from:** Session 1 OAuth route is proved, including any required registered redirect; session 4 exposes relay session state.
- **Ends with:** A6 passes at unit/integration level and has a prepared real-account procedure.
- **Owns:** `packages/core/src/relay/account/`, `packages/core/src/relay/deploy/`, `packages/vscode/src/relay/`, `packages/browser/src/relay/`, browser platform/background credential wiring and manifests/build wiring, affected relay/setup contracts. Matching tests and public barrels are included. Preserve unrelated working-tree edits.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 5.1 | Deliver the brief | contract | implementer; tests first for behavior/contracts | Ends with above | [ ] |
| 5.2 | Review and checks | task | main thread; architecture review for sync/formats | Evidence recorded | [ ] |

## 5.1 — Work package

Read the applicable repository rules and the contracts named below. This session is self-contained; do not read other session files or log.md. Production adapters are instantiated only in composition roots. Neutral core imports neither Node nor DOM nor app APIs. DOM components use core tokens/icons; apps never import each other. Keep source files under 200 lines where possible, never over 300, functions at most 50 lines, tests at most 500 lines and at most eight direct source files per directory; expose public indexes.

### Read only

- `documents/plans/browser-sharing-parity/research/feasibility.md` (technical gate evidence)
- `packages/vscode/src/relay/relayAccounts.ts:1–74`
- `packages/vscode/src/relay/connectRelay.ts:1–137`
- `packages/vscode/src/relay/updateRelayOnStart.ts:1–22`
- `packages/vscode/src/relay/signIn/cloudflareSignIn.ts:1–31`
- `packages/core/src/relay/deploy/oauth/authorizationRequest.ts:1–43`
- `packages/core/src/relay/deploy/oauth/cloudflareSession.ts:1–60`
- `packages/core/src/relay/deploy/oauth/storedLock.ts:1–58`
- `packages/browser/src/platform/browserApi.ts:1–5`

### Decided work

1. Move account shapes/validation, token refresh/access, deployment and update decisions to neutral core over SecretSlot and proven coordination ports. Keep VS Code SecretStorage, cancellation and callback integration in its adapter. Keep user credential formats readable.
2. Implement the browser callback from session 1, with exact redirect matching, state/PKCE validation, cancel/timeout and restart behavior. Add only demonstrated manifest permissions. A desktop client-id/redirect pair is not assumed valid for an identity callback. A required helper route stays a narrowly scoped adapter and does not become the browser collaboration host.
3. Confine credentials to the chosen extension context and coordinate rotating-token refresh/deployment across pages. Shared workflow calls do not expose raw owner secrets to DOM UI or content scripts. Disconnect forgets credentials and stops offering the local relay without deleting projects or pretending remote shares are revoked.
4. Reuse the bundled Worker/update path, with no generated Worker copy per app. Surface cancelled sign-in/deploy and partial failure; retry does not orphan duplicate relay resources. Token entry, if retained as an existing supported path, is explicit and does not satisfy browser OAuth acceptance.

### Verification

Test forged callbacks, cancellation, timeout, rotating refresh races, corrupt stored account, restart with expired access, deployment failure/retry and disconnect. Run core/browser/vscode typecheck/tests/builds and any affected helper package checks. Record real-account A6 separately in session 9; update contracts/setup docs and check size/shape.

Use tests under `packages/<pkg>/__tests__/` mirroring source. Add failing regression coverage before logic, format, sync or data-loss changes. Run `pnpm --filter @labshelf/<pkg> typecheck` and `pnpm --filter @labshelf/<pkg> test` for every touched package, including core when touched. Run relevant builds for runtime/build changes. Delete replaced implementations and unused imports/exports/tests in the same change; no old-path re-exports. Update affected durable contracts/docs in the same session. Never run `verify` unless the user requests it. Finish with what remains unchecked.

### Do not touch

Unrelated product features, the user's actual library, credentials in committed evidence, and external resources not created by an explicitly authorized run. Do not mark a real-runtime acceptance passed based only on mocks. No automatic commits or deployments are part of this brief.
