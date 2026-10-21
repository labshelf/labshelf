# Session 2 — Per-device write records in the folder

- **Goal:** Each device writes a record of the versions it wrote into its own file under `.labshelf/writes/`. A shared mirror never reads in a write from another mirror that is still in flight.
- **Starts from:** session 1 committed.
- **Ends with:** A4 passes as a test. `library-format.md`, `collaboration.md` and `sync.md` describe the record file, the device id and the in-flight wait.
- **Owns:**
  - `packages/core/src/library/writeRecords/` (new) and its tests;
  - `packages/core/src/library/node/deviceState/`;
  - `packages/core/src/collab/mirror/` and its tests;
  - `documents/contracts/{library-format,collaboration,sync}.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | Device id and record file format | contract | implementer (opus) | tests below | [ ] |
| 2.2 | Mirror: write records first, wait for in-flight writes | contract | implementer (opus) | A4 | [ ] |
| 2.3 | Review | — | `architecture-reviewer` on the session diff (format, sync) | no blocking finding | [ ] |
| 2.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 2.1 — Device id and record file format

- **Goal:** Add a stable random device id per library and a runtime-neutral read/write of `.labshelf/writes/<device id>.json`.
- **Read only:**
  - `documents/plans/stale-copies/research/collab-mirror.md`
  - `documents/plans/stale-copies/research/library-conflicts.md`
  - `documents/contracts/library-format.md` (the `.labshelf/` section and the device-local state section near line 41)
  - `packages/core/src/library/node/deviceState/deviceLocalLayout.ts`
  - `packages/core/src/collab/ownership/leaseFile.ts`, as the pattern for a JSON file under `.labshelf/` through the file port
- **Decided:**
  - **Device id.** A UUID created on first use and stored device-locally per library: Node at `<state>/libraries/<key>/device-id`, browser in its device state store. Exposed through a small port `DeviceIdentity { id(): Promise<string> }` that each composition root instantiates.
  - **Record file.** `<project>/.labshelf/writes/<deviceId>.json` = `{"version":1,"files":{"<posix path>":[{"hash","parent","by","at"}]}}`.
    - `parent` is a hash or `null`; `by` is `"mirror"` or `"app"`.
    - The newest 50 entries per path are kept. Written atomically through the file port.
    - Reading is defensive: an invalid file counts as empty, with a WARN.
  - **API in `library/writeRecords/`:**
    - `appendWriteRecord(fs, folder, deviceId, entry)`;
    - `readWriteRecords(fs, folder)`, which merges every device file into path → entries;
    - `recordFor(records, path, hash)`.
  - Only this device's file is ever written. INVARIANT: a device never writes another device's record file.
  - **Contract.** `library-format.md` describes the file. `sync.md` says why there is one file per device: sync tools never make conflict copies of the records.
- **Done when:** the failing tests come first (round trip, trim to 50, an invalid file reads as empty, merging two device files), then the core typecheck passes.
- **Do not touch:** the mirror and merge code (2.2, 2.3).

## 2.2 — Mirror: write records first, wait for in-flight writes

- **Goal:** Apply D6.
- **Read only:**
  - the files listed for 1.2 in session 1 (as committed);
  - `packages/core/src/library/writeRecords/index.ts`
- **Decided:**
  - **Write path.** `writeMirrored` appends `{hash, parent: <known before>, by: "mirror"}` to this device's record **before** the disk write.
  - **Reconcile.** In `reconcileText` and `reconcileBlob`, after the `written` check, a disk hash with a record `by: "mirror"` from any device, but not in `written`, is in flight. Mark the path waiting and do not touch the doc.
    - A doc update, or a `written` change for that path, re-runs the reconcile.
    - The wait has no time limit. A newer disk change replaces it. Log INFO once per wait.
  - **Unknown hash.** A disk hash in no record and not in `written`, while the share is connected, waits for one relay round trip (an index `since` answered) before it counts as an edit. Find the existing hook for "caught up" in the session or sync code and reuse it; do not add a timer.
  - **Contract.** Describe the in-flight rule and the one-round-trip wait in `collaboration.md` next to the D3 rules.
- **Done when:**
  - The failing tests come first in `__tests__/collab/mirror/inFlightWrites.test.ts`: two mirrors whose folders share a fake "cloud" (a test disk that copies files between them on demand, with delays).
  - A4: a mirror write copied by the cloud before its relay updates arrive is never read in; no duplicate text; the peer is unchanged.
  - An outside edit with no record still enters after the round trip.
  - The existing collab suites pass.
- **Do not touch:** `library/writeRecords/` internals beyond its index.
