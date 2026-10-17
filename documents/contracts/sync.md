# Contract: sync and several apps on one library

Read when you change sync, Drive access or how two apps share one library.

Every app that syncs must follow this contract. Breaking it can delete or duplicate a user's papers on another device. The sync engine and the coordinator that drives it live in core and are the same in every app. The coordinator runs one sync at a time, syncs 30 s after the last local change and runs periodic syncs. Apps supply only storage adapters, authentication, timers and the triggers that start a sync.

## Topology

```
local library folder ⇄ (VS Code | terminal, one at a time) ⇄ Google Drive ⇄ browser (IndexedDB)
```

VS Code and the terminal open the same local folder and share its manifest, so either one can sync it. The browser keeps its own copy, its own manifest and its own run record (key `google-drive.last.json`) in IndexedDB and meets the others on Drive. Any single app is enough to keep the library and Drive in step.

## Namespaces on Drive

| Namespace | Drive location | Local source | Contents |
|---|---|---|---|
| `library` | visible folder `LabShelf Library` (scope `drive.file`) | `papers/` | one folder per paper, plus the user's folders |
| `appdata` | hidden `appDataFolder` (scope `drive.appdata`) | `.research/papers/` | `<paperId>/data.json` sidecars |
| `projects` | visible folder `LabShelf Projects` (scope `drive.file`) | each writing project on the device | `<project id>/` with the project's files ([Projects](#projects)) |

Dot files are synced like any other file. The browser marks an empty folder with a `.keep` file.

Nothing else is uploaded. The VS Code AI database, logs, `.research/projects.json` and the files in `.research/sync/` stay on the device ([library-format.md](library-format.md)). VS Code and the terminal sync all three namespaces; the browser syncs `library` and `appdata`.

An app only sees, through these scopes, the files that its own Google Cloud project created. All three apps therefore use OAuth clients from one Google Cloud project. VS Code and the terminal share the same Desktop client, and the browser uses a Web client.

## Projects

The `projects` namespace mirrors writing projects, both those under `<library>/projects/` and the folders registered in `.research/projects.json`. `LabShelf Projects` is a folder of its own beside `LabShelf Library`, never inside it, because everything under `LabShelf Library` maps to `papers/`.

- **Identity.** A project's Drive folder is named after its `labshelf.yaml` `id`, on Drive and on every device. Two projects with the same id are the same project: a folder registered on two devices with the same `labshelf.yaml` syncs as one.
- **Scope of a run.** A run syncs only the projects present on the device, each against `LabShelf Projects/<project id>/`. A project that is not on the device (removed from LabShelf, deleted, or on an unmounted disk) is left out: its Drive folder and its manifest entries stay as they were, so it never deletes anything on Drive.
- **Only on Drive.** A folder in `LabShelf Projects` whose id has no project on the device is reported by the run and is never downloaded on its own. The user chooses where it goes: under `<library>/projects/`, or into a folder that is then registered.
- **Ignored paths.** The engine neither uploads, downloads nor deletes:
  - any path with a segment named `.git` (the project's repository stays the user's);
  - `.labshelf/state.json` (a per-device file);
  - a hidden folder directly under `.labshelf/versions/` (a version being written);
  - a path matching a pattern in the project's `labshelf.yaml` `ignore:` list ([library-format.md](library-format.md#labshelfyaml)).

  An ignored path keeps its manifest entry, if any, untouched.
- **Manifest.** Paths are `<project id>/<path in the project>`, and the recorded root is the `LabShelf Projects` folder.

## Three-way diff

For each path the engine compares the manifest (the last agreed state), the local tree and the remote tree. A local change is a different content hash than the manifest. A remote change is a different `modifiedTime` than the manifest.

| Manifest | Local | Remote | Result |
|---|---|---|---|
| absent | present | absent | upload |
| absent | absent | present | download |
| absent | present | present | unchanged if the hashes are equal, else conflict |
| present | changed | unchanged | upload |
| present | unchanged | changed | download |
| present | missing | unchanged | delete remote |
| present | unchanged | missing | delete local |
| present | changed or missing | changed or missing | conflict, unless both are missing |

A local folder that cannot be read is left out of the run: nothing under it is deleted, uploaded or downloaded, and its manifest entries stay as they were.

**Conflicts keep both copies.** The remote file is renamed to `<name> (conflict YYYY-MM-DD).<ext>` and the local file is uploaded. A conflict never deletes anything.

The manifest is saved only after a run completes without a fatal error.

## Folder names

On Drive a paper folder is named after the paper's title. Control characters and slashes are removed, the name is capped at 255 characters, and the paper id is the fallback. Locally the folder is named after the paper id, which is its cite key. One shared core function produces both names.

When a remote folder is scanned, its local name is chosen in this order:

1. the name its files were synced under before, found in the manifest by remote file id (a title change never renames or re-downloads a folder);
2. the `citekey` from the folder's `metadata.yaml`, downloaded once (a paper added on another device lands under its id, so its sidecar lines up);
3. the id that the title maps to in the app's own index;
4. the display name (the user's folders).

Within one parent folder, two remote folders never share a local name. The strongest claim keeps the name. The other falls back to its display name, then to the display name plus part of its Drive id. A citekey that contains a slash or a control character, or that is `.` or `..`, is not used as a name.

## Remote identity

The manifest records the Drive root folder id of each namespace. If the root differs from the recorded one, the engine clears that namespace's manifest entries and runs it as a first sync: it deletes nothing locally and uploads the local files. A different root comes from signing in with another account or another OAuth client, or from the user trashing and recreating the folder. If the recorded root matches, an empty remote is a real deletion and is applied.

## Coordination between local apps

VS Code and the terminal coordinate only through files. Never add a direct channel between them.

| File | Purpose |
|---|---|
| `~/.config/labshelf/config.json` (respects `XDG_CONFIG_HOME`) | `{"version":1,"libraryRoot":"/abs/path", …}`. Every app that writes it keeps the keys it does not own. |
| `.research/sync/google-drive.state.json` | the manifest, shared by both local apps |
| `.research/sync/google-drive.lock` | the sync lock (below) |
| `.research/sync/google-drive.last.json` | the last successful run by any app: `{providerId, app, host, startedAt, finishedAt, uploaded, downloaded, deletedLocal, deletedRemote, conflicts}` |

**Lock.** The lock file is the JSON `{app, pid, host, token, acquiredAt, heartbeatAt}`. It is written to a temporary file and linked into place, so it never exists half-written. The holder refreshes `heartbeatAt` every 20 s. Other apps judge a holder as follows:

- On the same host, by its process only. A live pid keeps the lock even with an old heartbeat, for example after Ctrl-Z or sleep. A dead pid is taken over at once.
- On another host, by its heartbeat. A heartbeat older than 2 min is taken over, after re-reading the file so a lock that was just renewed is not stolen.

Only the owner releases the lock (token check). An app that finds the lock held skips that run, and the next trigger catches up. Periodic syncs are skipped when the run record is younger than half their interval.

**Change propagation.** A sync by one app reaches the other app as file events, never as a message:

- the terminal watches `papers/` and `.research/papers/` and rescans;
- VS Code watches the same trees, reindexes, and drops index entries whose folder lost its `metadata.yaml`;
- changes reach the browser through Drive on the next sync on each side.

**Status ownership.** An app that rewrites `metadata.yaml` for its own reasons, such as resolved metadata or a text-layer verdict, keeps the `status` that is on disk. Only an explicit status change writes `status`.

Coordination files are advisory. An unreadable lock or run record counts as absent, and a failure in these files never fails a sync or an edit.

## Authentication

Each app signs in on its own and stores its own tokens:

| App | Flow | Token storage |
|---|---|---|
| VS Code | OAuth PKCE with a loopback server | `SecretStorage` |
| terminal | OAuth PKCE with a loopback server | OS keychain, else a file with mode 0600 |
| browser | `identity.launchWebAuthFlow` | extension storage |

Setting up the OAuth clients is covered in [../apps/README.md](../apps/README.md#google-oauth-clients).
