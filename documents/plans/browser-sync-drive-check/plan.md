# Plan: browser sync Drive check

Status: approved
Size: P — one manual check on a scratch Drive; grows to M if a folder is renamed or duplicated
Pending decisions: 0

## 1. Goal

Confirm on a real Drive that browser sync, which runs through the core sync coordinator, keeps existing Drive folders and names new ones after the paper title. The code and its regression tests are in place; only the check against Drive is open.

## 2. Decisions

- [x] **D1** The check runs on a scratch Drive account, never on a real library. — A wrong rename or duplicate on Drive reaches every app.

## 3. Scope

- **In:** the browser extension's Drive sync.
- **Out:** code changes, unless the check fails.
- **Contracts touched:** none. The check verifies [sync.md](../../contracts/sync.md#folder-names).

## 4. Acceptance criteria

- [ ] **A1** After an upgrade sync on a scratch Drive, the folders the earlier build created keep their names and ids, and none gains a title-named sibling.
- [ ] **A2** A paper saved after the upgrade gets a folder named after its title.
- [ ] **A3** A file uploaded on Drive into an old folder arrives in the browser library.
- [ ] **A4** The last sync time survives an extension reload.

## 5. Design

Nothing new. Browser sync passes `listTitles` from its paper records and keeps the run record in IndexedDB under `google-drive.last.json`. The engine registers every remote folder under its manifest-first local name and creates folders only for unregistered paths.

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | scratch-Drive check, A1–A4 | only if the check finds a bug |

Runner tiers:

- **H**: the session model (Opus or Fable). Use it for design, algorithms and judgment.
- **M**: Sonnet. Use it for well-specified implementation, moves and tests.
- **L**: Haiku. Use it for gates, import fixes and commits.

This plan's only step is run by the user.

## 7. Risks

- **R1** The check runs against the wrong account and renames real folders. — Use a separate browser profile signed in only to the scratch account.

## 8. Log

See [log.md](log.md). When A1–A4 are checked, delete this directory.
