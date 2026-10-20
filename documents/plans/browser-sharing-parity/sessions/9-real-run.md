# Session 9 — Verify cross-app sharing and recovery

- **Goal:** Prove parity through installed browser extension pages and real VS Code hosts using isolated data.
- **Starts from:** Sessions 1–8 complete; real Cloudflare authorization requires the account owner when requested by the provider.
- **Ends with:** A1–A11 have recorded evidence or explicit failures; the plan is complete only when all required cases pass.
- **Owns:** Mirrored integration tests in affected packages, reusable harnesses under `scripts/` only when multiple sessions use them, `documents/apps/browser.md`, `documents/apps/vscode.md`, plan evidence/session/log. Fixes to production code return to the responsible session scope. Matching tests and public barrels are included. Preserve unrelated working-tree edits.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 9.1 | Deliver the brief | contract | implementer; tests first for behavior/contracts | Ends with above | [ ] |
| 9.2 | Review and checks | task | main thread; architecture review for sync/formats | Evidence recorded | [ ] |

## 9.1 — Work package

Read the applicable repository rules and the contracts named below. This session is self-contained; do not read other session files or log.md. Production adapters are instantiated only in composition roots. Neutral core imports neither Node nor DOM nor app APIs. DOM components use core tokens/icons; apps never import each other. Keep source files under 200 lines where possible, never over 300, functions at most 50 lines, tests at most 500 lines and at most eight direct source files per directory; expose public indexes.

### Read only

- `documents/plans/browser-sharing-parity/research/feasibility.md` (technical gate evidence)
- `documents/apps/browser.md:1–141`
- `documents/apps/vscode.md:1–128`
- `documents/apps/README.md:1–39`
- `documents/contracts/collaboration.md:1–156`
- `documents/contracts/share-link.md:1–100`
- `documents/plans/project-collaboration/sessions/11-real-run.md:1–37`
- `packages/browser/__tests__/library-page/editor/collab/twoPeers.test.ts:1–102`

### Decided work

1. Use scratch libraries, isolated profiles/config/tokens and launched test-host PIDs only. Verify browser-origin/browser join, browser-origin/VS Code join, VS Code-origin/browser join, and browser/browser across Chrome/Firefox. Use distinct library copies for collaboration and a dedicated same-physical-folder contention case.
2. For each origin, edit offline, reload/restart, interrupt storage, reopen with the other member offline, change text/settings/blobs, rename/delete, restore history, undo and comment. Include failed quota/write, permission loss, unavailable bridge, malformed invite/frame/path, two-tab owner death and source switch with pending writes. Check content on disk and in recovered docs, not just DOM messages.
3. Connect real Cloudflare through each app; exercise token expiry/restart, Worker update, second relay, relay outage and fresh-socket-only refusal. Record account resource ownership and costs without secrets. Account sign-in/deployment approval remains a concrete execution step, not a prerequisite to writing or implementing this plan. Clean only resources created by the run; never touch the website Worker.
4. Create/import/revoke paper links from both apps and open them on the public page with a real PDF. Inspect UI screenshots and keyboard behavior on Chrome/Firefox and VS Code. Test picked-folder only where that browser supports it; record unsupported combinations rather than claiming a pass.
5. Run touched-package typechecks/tests/builds, review boundaries, duplication, dead exports, size/shape and documentation. Do not invoke verify. Record unmet checks plainly; do not close the separate project-collaboration real-run session without its evidence. On full completion remove this plan directory under repository plan-retention rules, retaining durable verification recipes in app docs.

### Verification

Use the documented real-app recipes directly. Final evidence maps A1–A11 to environment, commands, observed content and failures. Repeat checks only after relevant fixes. Real authentication, offline/restart and cross-process ownership cannot be substituted with unit-test results.

Use tests under `packages/<pkg>/__tests__/` mirroring source. Add failing regression coverage before logic, format, sync or data-loss changes. Run `pnpm --filter @labshelf/<pkg> typecheck` and `pnpm --filter @labshelf/<pkg> test` for every touched package, including core when touched. Run relevant builds for runtime/build changes. Delete replaced implementations and unused imports/exports/tests in the same change; no old-path re-exports. Update affected durable contracts/docs in the same session. Never run `verify` unless the user requests it. Finish with what remains unchecked.

### Do not touch

Unrelated product features, the user's actual library, credentials in committed evidence, and external resources not created by an explicitly authorized run. Do not mark a real-runtime acceptance passed based only on mocks. No automatic commits or deployments are part of this brief.
