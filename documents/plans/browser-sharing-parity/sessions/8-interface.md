# Session 8 — Expose common sharing actions in both apps

- **Goal:** Mount the same sharing controls and dialogs over the completed workflows.
- **Starts from:** Sessions 4–7 provide real host operations and state.
- **Ends with:** A9 is inspectable in browser pages and VS Code webviews.
- **Owns:** `packages/core/src/collab/dom/`, `packages/core/src/share/dom/`, library-ui/allProjects DOM and message protocols, VS Code UI hosts/sidebar menus/contributions, browser library-page/sidebar/host/options wiring, `documents/contracts/library-ui-host.md`, affected product/setup docs. Matching tests and public barrels are included. Preserve unrelated working-tree edits.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 8.1 | Deliver the brief | contract | implementer; tests first for behavior/contracts | Ends with above | [ ] |
| 8.2 | Review and checks | task | main thread; architecture review for sync/formats | Evidence recorded | [ ] |

## 8.1 — Work package

Read the applicable repository rules and the contracts named below. This session is self-contained; do not read other session files or log.md. Production adapters are instantiated only in composition roots. Neutral core imports neither Node nor DOM nor app APIs. DOM components use core tokens/icons; apps never import each other. Keep source files under 200 lines where possible, never over 300, functions at most 50 lines, tests at most 500 lines and at most eight direct source files per directory; expose public indexes.

### Read only

- `documents/plans/browser-sharing-parity/research/feasibility.md` (technical gate evidence)
- `packages/core/src/library-ui/dom/header/listHeader.ts:1–73`
- `packages/core/src/library-ui/dom/sidebar/sidebarProjects.ts:1–92`
- `packages/core/src/library-ui/dom/sidebar/mountLibrarySidebar.ts:1–181`
- `packages/core/src/writing/allProjects/dom/projectMenu.ts:1–50`
- `packages/vscode/src/ui/library/projectCommands.ts:1–53`
- `packages/vscode/src/sidebarWebview/projectMenu.ts:1–38`
- `packages/browser/src/library-page/sidebar/sidebarProjects.ts:1–68`
- `packages/browser/src/library-page/projectWiring/mountProjectWiring.ts:1–61`

### Decided work

1. Add a visible Share button beside the open project title in both hosts; add Share/Copy invite to project sidebar and All projects menus. Add visible Join to the Projects entry and empty state. Place Share folder in the open folder toolbar and folder menu; add Manage shared links and Import shared link in Library.
2. Build core DOM dialogs with host operations for project invites, leave, paper-folder annotation choice, link management and import. Respect connection/persistence state, progress and cancellation. Explain anyone-with-link edit access, device-local leave and read-only paper snapshots; do not offer roles or email invites absent from the contracts.
3. Use existing tokens, inline SVG icons and widgets. Provide keyboard access, accessible names/focus recovery and narrow layout. Host capability messages are validated on receipt, including project/folder eligibility; UI hiding is not authorization. Do not show write controls on public read-only share pages.
4. Both hosts map UI actions to the same core workflows. Keep palette commands working and remove duplicated dialogs/workflow branches that the common UI replaces. Connect browser account settings without exposing infrastructure implementation details beyond decisions users need to make.

### Verification

No layout/copy-only tests. Add protocol validation and host eligibility tests for trust-boundary changes. Run core/browser/vscode typecheck/tests and builds; inspect light/dark/narrow/keyboard states with existing app launch recipes, without invoking verify. Update host contract/setup docs and check size/shape.

Use tests under `packages/<pkg>/__tests__/` mirroring source. Add failing regression coverage before logic, format, sync or data-loss changes. Run `pnpm --filter @labshelf/<pkg> typecheck` and `pnpm --filter @labshelf/<pkg> test` for every touched package, including core when touched. Run relevant builds for runtime/build changes. Delete replaced implementations and unused imports/exports/tests in the same change; no old-path re-exports. Update affected durable contracts/docs in the same session. Never run `verify` unless the user requests it. Finish with what remains unchecked.

### Do not touch

Unrelated product features, the user's actual library, credentials in committed evidence, and external resources not created by an explicitly authorized run. Do not mark a real-runtime acceptance passed based only on mocks. No automatic commits or deployments are part of this brief.
