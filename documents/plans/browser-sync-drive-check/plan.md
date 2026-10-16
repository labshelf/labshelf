# Plan: browser sync Drive check

Status: approved
Size: 1 session — one manual check on a scratch Drive; grows if a folder is renamed or duplicated

## 1. Goal

Confirm on a real Drive that browser sync, which runs through the core sync coordinator, keeps existing Drive folders and names new ones after the paper title. The code and its regression tests are in place; only the check against Drive is open.

## 2. Decisions

- [x] **D1** The check runs on a scratch Drive account in a separate browser profile signed in only to that account, never on a real library. — A wrong rename or duplicate on Drive reaches every app.
- [x] **D2** No code changes unless the check fails. The check verifies [sync.md](../../contracts/sync.md#folder-names) and touches no contract.
- [x] **D3** Browser sync passes `listTitles` from its paper records and keeps the run record in IndexedDB under `google-drive.last.json`. The engine registers every remote folder under its manifest-first local name and creates folders only for unregistered paths.

## 3. Acceptance

- [ ] **A1** After an upgrade sync on a scratch Drive, the folders the earlier build created keep their names and ids, and none gains a title-named sibling.
- [ ] **A2** A paper saved after the upgrade gets a folder named after its title.
- [ ] **A3** A file uploaded on Drive into an old folder arrives in the browser library.
- [ ] **A4** The last sync time survives an extension reload.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | scratch-Drive check, A1–A4 | none (a fix, if the check fails, owns the files it touches) | alone |
