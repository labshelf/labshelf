# Session 9b — Finish the cross-app sharing real run

- **Goal:** Close every A1–A11 case that [real-run-evidence.md](../research/real-run-evidence.md) records as NOT VERIFIED or FAIL, including real Cloudflare through each app.
- **Starts from:** HEAD with 43ef127, 149b13b, f1543a5, 00867ca and 7225dba on main; a Mac with the user present for Cloudflare sign-in.
- **Ends with:** A1–A11 each have recorded evidence or an explicit failure; the plan is complete only when all required cases pass. Then remove this plan directory under the plan-retention rules.
- **Owns:** Mirrored tests in affected packages, `documents/apps/verify.md`, plan evidence/session/log. Production fixes stay minimal and come with a failing test first. Preserve unrelated working-tree edits.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 9b.1 | Re-run the open cases | contract | implementer with the user present | Ends with above | [ ] |
| 9b.2 | Review and checks | task | main thread | Evidence updated | [ ] |

## 9b.1 — Work package

Read the repository rules and the contracts named below. This session is self-contained; do not read other session files or log.md. Production adapters are instantiated only in composition roots. Apps never import each other. Keep source files under 200 lines, functions at most 50 lines, tests at most 500 lines and at most eight direct source files per directory.

### Read only

- `documents/plans/browser-sharing-parity/research/real-run-evidence.md` (what ran, what remains)
- `documents/apps/verify.md` Browser sections "Headless run", "Collaboration against a local relay", "Headless Firefox"
- `documents/apps/verify.md` VS Code section "Collaboration host run"
- `documents/apps/verify.md` Rules
- `documents/contracts/collaboration.md:1–156`
- `documents/contracts/share-link.md:1–100`

### Decided work

1. Re-run A4 catch-up in Chromium after f1543a5: edit offline, reload or restart, reconnect, close the editing profile, open the peer, and compare text on disk and in recovered docs.
2. Run the cases that did not run, against local relays first: A1 leave (the menu entry is "Stop Sharing on This Device…") and browser-to-VS Code join; A2 cross-app comment, reply and history restore; A3 blob add, rename, delete and shared versus personal settings; A4 failed persistence write; A5 failover to a second relay; A7 two-tab lease and the same-folder lease with two VS Code hosts; A8 paper links created, imported and revoked from both apps and opened on the public page with a real PDF; A9 dialog screenshots, Tab and Escape, narrow width in Chromium, Firefox and VS Code; A10 malformed invite and picked folder in Chromium, and the Firefox Share, Import Shared Link and Manage Shared Links dialogs.
3. Check on Firefox that `tabs.onUpdated` sees the OAuth redirect to `http://127.0.0.1:8976/callback` from a tab the page opened (adapt `research/proof/run.mjs`).
4. With the user present on their Mac, connect real Cloudflare through each app: sign-in, deploy, token expiry and refresh rotation, Worker update, fresh-socket refusal, a second real relay, relay outage. Record account resource ownership and costs without secrets. Clean only resources the run created; never touch the website Worker.
5. Confirm or file each open observation in the evidence file: joiner project name `project`, stale sidebar menu after sharing, unlabeled named cursors without a display name, the one-hour down mark for a single relay after a short outage (a design question: ask the user before changing the contract), and the re-read of the account after a cancelled Connect Cloudflare prompt.
6. Run touched-package typechecks, tests and builds; the four root-only core permission tests are checked as user `nobody`. Do not invoke verify. Update the evidence file and the app docs; record unmet checks plainly.

### Verification

Use the documented recipes directly with isolated profiles, scratch libraries and launched PIDs only. Final evidence maps A1–A11 to environment, harness, observed content and failures. Real authentication, offline/restart and cross-process ownership cannot be substituted with unit-test results. Finish with what remains unchecked.

### Do not touch

Unrelated product features, the user's actual library, credentials in committed evidence, and external resources not created by an explicitly authorized run. No automatic commits or deployments.
