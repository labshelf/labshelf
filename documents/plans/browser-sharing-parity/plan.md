# Plan: Sharing parity between browser and VS Code

Status: draft
Size: 9 sequential sessions — shared collaboration engine, browser persistence and authentication, complete sharing flows, common UI, cross-app verification

## 1. Goal

Users share and join writing projects from the browser and VS Code with the same file fidelity, offline recovery, relay failover and visible actions. Both apps create, import and revoke read-only paper-folder links. One core implementation owns each reusable behavior; apps supply storage, authentication callbacks, editor bindings and host wiring.

This plan covers collaboration and sharing parity, not every writing or compilation feature. It requires neither a running VS Code nor a native helper for browser collaboration over an IndexedDB library.

## 2. Decisions

- [ ] **D1** Keep the invite, encryption, relay and share-link protocols defined by [collaboration](../../contracts/collaboration.md), [relay](../../contracts/relay.md) and [share links](../../contracts/share-link.md). Add browser persistence and lifecycle guarantees to those contracts; change a wire format only for a demonstrated requirement with compatibility tests for user data.
- [ ] **D2** Extract orchestration from VS Code into runtime-neutral `core/collab` and `core/relay`: connection startup/shutdown, relay selection/watch, share/join/resume/leave, invite reconstruction, relay offering and credential/deployment lifecycle. Native editor binding and platform callbacks remain adapters. Switch the existing VS Code consumer in each extraction, before introducing a browser consumer; delete superseded implementations and exports in that session.
- [ ] **D3** Extract mirror reconciliation from `core/collab/node/mirror` over the existing `LibraryFileSystem`, `PathOps` and project-file read ports. Node retains filesystem watching and platform reads; browser adapters report mutations and scan for external changes. Share text, blobs, settings, bibliography and comments with the same conflict rules, including renames and deletions.
- [ ] **D4** Define only the state ports needed by the shared session and mirror. Node keeps the documented disk format; browser stores Yjs updates/snapshots, blobs, agreed hashes and relay cursors in IndexedDB, outside user library content. Hydrate stored docs before constructing the synchronous Yjs doc factory. Persist covered document updates before advancing a relay cursor; flush failures remain visible and retryable.
- [ ] **D5** Scope state by stable library identity plus share id, not project title or relay URL. Browser secrets stay in extension-local storage, never sync storage, library files, website storage, logs or content-script responses. Preserve existing stored browser invites through a tested data migration. Extension storage is not described as equivalent to an OS keychain.
- [ ] **D6** A library page owns its live sessions; closing every page ends connectivity, with persisted edits available on reopen. No permanent MV3 worker is required. Coordinate tabs through a browser-owned exclusive lease per library/share; another tab observes ownership and offers a deliberate handoff. Prevent concurrent disk mirroring by browser and VS Code against the same physical project, using a shared disk lease or a proven equivalent. Separate libraries remain independent peers.
- [ ] **D7** Session 1 proves the browser OAuth callback and token-exchange route on Chrome and Firefox before credential wiring. Reuse core PKCE, state validation, token refresh and deploy clients. Prefer a registered extension identity redirect when supported; the existing client registers a loopback redirect, so identity support is not an assumption. A failed proof leaves OAuth parity explicitly blocked; an API-token path can support development but does not satisfy sign-in acceptance. No credential proxy or public server is introduced implicitly.
- [ ] **D8** Move reusable relay-account parsing, refresh serialization and deploy/update decisions from VS Code to core. Browser owns its credential store, callback and lifecycle adapters; VS Code owns SecretStorage and the desktop callback. Serialize refresh and deployment across browser contexts; never log bearer credentials or complete invite links.
- [ ] **D9** Move folder selection, paper input collection and share workflow decisions from VS Code into `core/share`, reusing build/upload/open/import/revoke and `ShareRegistryStore`. Browser provides a transactional registry outside library content. Preserve interrupted uploads for revocation and refuse to overwrite malformed registries. Annotations import retains the existing core behavior; extending it is a separate feature.
- [ ] **D10** Put common DOM sharing controls/dialogs in core, driven by narrow host capabilities and validated messages. Show Share on an open project, Share/Copy invite in sidebar and All projects menus, Join in Projects and its empty state, Share folder on a paper folder, and Manage/Import links in Library. No whole-library live sharing, role picker, email invitations or immediate global member revocation is promised. Leaving affects this device; paper links are read-only snapshots.
- [ ] **D11** All browser storage sources participate: IndexedDB, a picked folder and the native bridge. Changing source or losing permission stops the affected mirror without redirecting writes to another source. Shared-folder changes made outside the app enter reconciliation. Image insertion, file operations, history restore and helper buffers use the shared mutation/session path; failures do not silently switch a shared editor to independent local editing.
- [ ] **D12** Work sequentially. A session touching manifests, dependency manifests, lockfiles, tsconfigs or build scripts runs alone. Source files meet repository size, directory and public-barrel rules. Reuse dependencies and ports before adding any. Test logic, formats, sync and data-loss behavior first; inspect layout manually. Never run `verify` unless requested.

Open: no product decision blocks writing the plan. Browser OAuth callback registration and cross-process mirror ownership are technical gates, resolved with evidence in session 1 before dependent implementation.

## 3. Acceptance

- [ ] **A1** Each app creates a share, copies its invite again, accepts an invite from either app and leaves while retaining local files. Cancelled setup creates no partial shared project.
- [ ] **A2** Browser ↔ VS Code text edits converge with named cursors, own-only undo, anchored comments and replies; restoring history propagates as edits.
- [ ] **A3** Images and other binaries, file additions, renames, deletions, shared settings and bibliography converge. Personal project settings remain personal. An outside-folder edit is imported; concurrent edits and deletion conflicts preserve recoverable content.
- [ ] **A4** Offline edits survive page reload, browser restart and abrupt termination after the storage acknowledgment. Reconnecting with the other member offline catches up from the relay. A failed persistence write never advances its cursor or claims durable success.
- [ ] **A5** Clients converge on a working relay when the first is down or refuses only fresh sockets. Relay offering/withdrawal and persisted cursors behave alike in both apps.
- [ ] **A6** Browser signs in to Cloudflare, deploys/updates a relay, refreshes expired credentials after restart, and disconnects without deleting projects. Concurrent tabs cannot reuse a rotating refresh token or race a deployment. Cancellation and refusal expose actionable errors.
- [ ] **A7** Two tabs opening one share cause no competing mirrors or lost edits; ownership handoff and owner termination recover. Browser and VS Code opening the same physical project do not race writes. Switching libraries cannot apply pending writes to the other library.
- [ ] **A8** Both apps create paper-folder links with/without annotations, reopen/copy them, import papers, report duplicates/missing PDFs and revoke. Interrupted upload/revoke remains manageable after restart; malformed registry data is preserved. The website still opens and downloads either app's links.
- [ ] **A9** Share, Join, Copy invite, Leave, Share folder, Manage links and Import link are discoverable in both apps. Dialogs explain edit access versus read-only copies and expose progress, cancellation and connection failure; keyboard and narrow layouts work.
- [ ] **A10** Chrome and Firefox pass browser scenarios across IndexedDB, picked-folder support where available, and bridge storage. Permission loss, unavailable native host, quota exhaustion and malformed remote data preserve local content and report errors.
- [ ] **A11** Existing Node state, browser stored invites and paper-link registries remain readable; app boundaries hold; reusable workflow implementations exist once in core, with platform adapters in apps. Per-package typechecks/tests and relevant builds pass.

## 4. Sessions

Every session is self-contained. Sessions execute in order; acceptance is not complete until its runtime evidence exists. The separate [project-collaboration real run](../project-collaboration/sessions/11-real-run.md) remains pending until its own checks run; this plan does not mark it passed by inference. Broader browser writing companion work is outside this scope.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [1-feasibility.md](sessions/1-feasibility.md) | OAuth and same-folder ownership proofs | plan research/session 1, isolated scratch fixtures | alone |
| 2 | [2-persistence.md](sessions/2-persistence.md) | Shared state ports and durable browser adapter | core collab state, browser collaboration storage, contracts | alone |
| 3 | [3-mirror.md](sessions/3-mirror.md) | One mirror with Node/browser adapters | core collab mirror, app filesystem notifications/ownership | alone |
| 4 | [4-session.md](sessions/4-session.md) | One session and relay orchestration | core collab session/relays, both app connection wiring | alone |
| 5 | [5-cloudflare.md](sessions/5-cloudflare.md) | Shared account lifecycle, browser sign-in | core relay account/auth, VS Code relay, browser relay/platform/manifests | alone |
| 6 | [6-project-flows.md](sessions/6-project-flows.md) | Share/join/resume/leave with editor integration | core collab lifecycle/comments, app project/editor/review glue | alone |
| 7 | [7-paper-links.md](sessions/7-paper-links.md) | Shared paper-link workflows | core share, VS Code share, browser share/storage/host | alone |
| 8 | [8-interface.md](sessions/8-interface.md) | Common sharing controls | core DOM/protocols, app UI hosts, browser options, VS Code contributions | alone |
| 9 | [9-real-run.md](sessions/9-real-run.md) | Cross-app failure and recovery verification | integration tests, app verification docs, plan evidence | alone |

Ownership includes matching mirrored tests, affected public barrels, runtime tsconfigs/build wiring when required, and affected contracts. No session edits unrelated working-tree changes. Full path scopes and implementation entry points are in each session.
