# Plan: browser sync Drive check

Status: approved
Size: P — one manual check on a scratch Drive; grows to M if a folder is renamed or duplicated.
Pending decisions: 0

## 1. Goal

Confirm on a real Drive that browser sync, which runs through the core sync coordinator, keeps existing Drive folders and names new ones after the paper title. The code and its regression tests are in place; only the check against Drive is open.

## 2. Decisions

- [x] **D1** The check runs on a scratch Drive account, never on a real library. — A wrong rename or duplicate on Drive reaches every app.

## 3. Scope

- **In:** the browser extension's Drive sync.
- **Out:** code changes, unless the check fails.
- **Contracts touched:** none. The check verifies [sync.md](../contracts/sync.md#folder-names).

## 4. Acceptance criteria

- [ ] **A1** After an upgrade sync on a scratch Drive, the folders the earlier build created keep their names and ids, and none gains a title-named sibling.
- [ ] **A2** A paper saved after the upgrade gets a folder named after its title.
- [ ] **A3** A file uploaded on Drive into an old folder arrives in the browser library.
- [ ] **A4** The last sync time survives an extension reload.

## 5. Design

Nothing new. Browser sync passes `listTitles` from its paper records and keeps the run record in IndexedDB under `google-drive.last.json`. The engine registers every remote folder under its manifest-first local name and creates folders only for unregistered paths.

## 6. Sessions and steps

### Session 1 — scratch-Drive check

- **Starts from:** a clean tree; a scratch Google account signed in to a test browser profile.
- **Ends with:** A1–A4 checked, and this plan deleted.
- **Commit:** only if the check finds a bug.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | Upgrade sync on a scratch Drive | — | user | A1–A4 | [ ] |

### Step blocks

#### S1 — Upgrade sync on a scratch Drive

- **Do:**
  - build the extension from a commit before `browserSync` used the coordinator, load it in the test profile and sync two papers to the scratch Drive;
  - load the current build in the same profile, add a file to one old paper and save a new paper, then sync;
  - upload a file on Drive into an old paper's folder and sync again;
  - reload the extension and open the options page.
- **Context:** the regression tests that pin this are in `packages/browser/__tests__/sync/` and core's sync engine tests. How to run the extension: [apps/README.md](../apps/README.md#verifying-changes).
- **Done when:** A1–A4.

## 7. Risks

- **R1** The check runs against the wrong account and renames real folders. — Use a separate browser profile signed in only to the scratch account.

## 8. Log
