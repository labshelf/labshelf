# Contract: library format

Read when you change a file the library stores on disk, the device-local files, the shared configuration or how conflict copies are merged.

A library is a folder the user owns, moved between devices by their sync tool. Every app, and any older or newer version of it, reads and writes the same files, so a name, a key or a rule here cannot change without breaking libraries already on disk. The file rules of [code.md](../code.md#files) apply to every file below.

## Layout

```
<library root>/
  papers/<folder>/…/<paper id>/    the user's folders, any depth; a folder holding metadata.yaml is a paper
    metadata.yaml  paper.pdf  bib.bib (generated)  and the user's attachments, kept and moved with the paper
  projects/<project id>/           a folder holding labshelf.yaml is a project
  templates/<template id>/         My templates, see templates.md
  spaces/<space id>/               see spaces.md
  .research/
    papers/<paper id>/data.json    the sidecar; synced
    papers/<paper id>/notes.qmd    the paper's notes, see qmd-items.md; synced
    tmp/ staging/ templates/       scratch the apps rebuild; the user may exclude them from sync
```

The browser without a folder keeps the same tree in IndexedDB under the same relative paths.

## Paper identity

- The paper id is the folder name and equals the cite key. It never changes, also when the paper moves. The sidecar and the notes are keyed by id, so annotations and notes follow the paper and a move orphans nothing.
- A new id is `authorYearWord` (`vaswani2017attention`). The surname comes only from a registry record or the PDF's XMP, never from a guess. A new id never collides, case-insensitively, with any paper or folder. Existing ids are never regenerated.
- When two papers share a cite key, the smallest id wins in every lookup.

## metadata.yaml

The source of truth for a paper; every paper list is rebuilt from it. Each key belongs to one action, and every other rewrite keeps it, so actions never clobber each other:

- A metadata refresh never touches `status` or `tags`, which are the user's.
- `pdfVersion` belongs to writing `paper.pdf`: set, or removed when the new version is unknown.
- `pdfRequestedAt` belongs to the request-a-copy action. It holds a day; the author's address is never stored.
- `statusChangedAt` belongs to a status change to a different value.
- `files` (name to description) belongs to the action that describes files, which also drops names missing on disk.
- `hasPdf` is derived on each device and never written.

`metadata.yaml` and `bib.bib` are written together.

## labshelf.yaml

A writing project is a folder with `labshelf.yaml`, under `projects/` or registered anywhere else on the device.

- `id` is the project's identity, unique case-insensitively among the device's projects, and never changes. Renaming writes `title` only.
- A shared project syncs `format`, `main`, `engine`, `bibliography`, `typst`, `title`, `figures`, `values`, `check`, `target` and `papers`. `id`, `folder`, `archived`, `trashed` and `shared` stay per user ([collaboration.md](collaboration.md)).
- `figures.<path>.run` is a shell command. It runs only after the user confirms that exact command on that machine, never because a synced file says so.
- `papers`: entries with `cited: true` belong to LabShelf, which adds and removes them as the sources cite library papers. Entries without it are the user's and are never removed. A rewrite keeps only `key`, `doi` and `cited`.
- LabShelf writes the keys it owns, `check.pages`, `check.words`, `check.countUpTo` and `target.*`, and never writes `figures`, `values` or other `check` keys. A malformed optional key fails the parse, naming the key, and a file that does not parse is never rewritten.
- Registering a folder writes `labshelf.yaml` if it has none and touches nothing else. Deleting a registered project only unregisters it; deleting one under `projects/` removes its folder.

```yaml
id: deep-nets-survey
format: latex
main: main.tex
figures:
  fig/ablation.pdf: { run: python plot_ablation.py, inputs: [plot_ablation.py, results/*.json] }
check: { pages: 9, words: 8000 }
target: { venue: NeurIPS 2027, deadline: 2027-05-15 }
papers:
  - { key: smith2020, doi: 10.1000/xyz123, cited: true }
```

## Generated files

LabShelf owns these in a project. The first line says so, and edits are overwritten.

- `labshelf.bib`: one entry per cited key that matches a library paper, without `file`. A Typst main that already calls `#bibliography` is left alone. In a shared project see [collaboration.md](collaboration.md#bibliography).
- `labshelf-values.tex`: LaTeX projects with `values:`. Defines `\lsvalue{<file>.<path>}` for each JSON leaf. The main file gets `\input{labshelf-values}` once.

## Project folder: `.labshelf/`

Files that travel with a project.

- `checklist.json`: the Checklist's hand-added items. Item ids are unique and never reused. Tasks written in the project's notes are derived from the note files and never stored here ([qmd-items.md](qmd-items.md#project-notes)).
- `comments.qmd`: comment threads on the project's text files, one item per comment ([qmd-items.md](qmd-items.md#comments)), anchored by a quote with 32 characters of context on each side. Ids are unique and never reused. A thread whose quote is found nowhere stays listed as detached. In a shared project the share writes the file and the anchor also holds `start` and `end` ([collaboration.md](collaboration.md#comments)).
- `versions/<slug>/`: a named snapshot (`version.json`, the built `paper.pdf`, `sources/`). The same slug replaces the version. A snapshot is built in a hidden `.<slug>.tmp-*` folder and renamed, so a sync tool never uploads a half snapshot; hidden folders are ignored. `version.json` comes from other machines, so an invalid one skips the folder.
- `writes/<device id>.json`: each device's record of the versions it wrote, read by every device to find divergent versions. A device writes only its own file, so devices never conflict on it. Timestamps in it are not an order across devices.
- `mirror-lease.json`: see [collaboration.md](collaboration.md#mirror-ownership).
- `state.json` is per device and is not read.

Beside `.labshelf/`, in the project folder, `notes/<slug>.qmd` holds the project's notes, as item files ([qmd-items.md](qmd-items.md#project-notes)).

## Sidecar: `data.json`

Annotations, theme and reading position of one paper. The annotation types are `highlight`, `comment` and `tag`; the paper's notes live in `notes.qmd` ([qmd-items.md](qmd-items.md)).

- Every app writes identical bytes for the same state (key order, `reading` omitted until first opened, `deleted` omitted while empty and sorted by `id`), so two apps never make the sync tool see a conflict.
- Annotation positions are normalised to the page (0..1), so any app and zoom reads them.
- Removing an annotation leaves a `deleted` marker. Without it a stale copy of the file from another device would bring the annotation back. Markers are dropped after 90 days, so a copy older than that can bring an annotation back; every app keeps them at least that long.
- Copies merge per annotation, the larger `updatedAt` winning; a marker removes its annotation unless the annotation was edited after it. `theme` and `reading` follow the newer file.

## Device-local files

What belongs to one device lives outside the library, because a sync tool would copy it to devices where it is wrong or make conflict copies of it.

- Each library has a folder named by its library key: the first 16 hex characters of the SHA-256 of the normalised root (absolute, symlinks resolved, Windows drive letter upper case) so VS Code and the terminal derive the same key. Moving the library gives it a new key.
- The cache side (`$XDG_CACHE_HOME/labshelf`, else the platform default) holds only what is rebuilt: the text index and the OpenAlex citation cache. The cache is rebuilt when it grows stale or a paper's DOI changes, and a cache file that is incomplete reads as missing.
- The state side (`$XDG_STATE_HOME/labshelf`, else the platform default) holds the `device-id` UUID, `projects.json` (absolute paths of project folders registered outside the library; removing a project never removes the folder), `merge-bases/`, `conflict-dismissals.json`, `collab/` ([collaboration.md](collaboration.md)), `shares.json` ([share-link.md](share-link.md)) and the logs.
- An empty `XDG_*` variable counts as unset. The browser keeps the same state in its own stores.

## Conflict copies

A sync tool that sees two devices change one file keeps both and renames one. LabShelf recognises the names of Syncthing, Nextcloud, Dropbox and rclone bisync, and the apps' own `.labshelf-conflict-<UUID>` copies. Other tools (Google Drive, OneDrive, iCloud) are recognised only inside writing projects, by content: a new text file that matches a known version of a sibling or is mostly the same lines. The user can say a file is not a version, and that is stored device-locally.

Resolution by file:

| File | Resolution |
|---|---|
| sidecar `data.json` | merged without asking |
| any `.qmd` item file | merged without asking, item by item ([qmd-items.md](qmd-items.md#merge)) |
| project text file with a base | merged three-way, line by line; overlaps kept between conflict markers |
| `space.json`, `glossary.json`, `metadata.yaml` | the user keeps mine or keeps the other |
| anything else, or a merge that fails | the user keeps mine, keeps the other or keeps both |

- A `.labshelf-conflict-<UUID>` copy is a divergent version another device already failed to merge cleanly: every device leaves it out of automatic merges and asks the user.
- A merge writes the file only if it did not change meanwhile, reads it back, and only then deletes the copies. Nothing else deletes a copy.
- `merge-bases/` keeps the versions three-way merges start from. An item file's base never takes a copy's text, because a copy may be this device's own version. Without a base an item file merges as a union by id, and any other file goes to the user.
- Shared projects leave copies to the share's mirror ([collaboration.md](collaboration.md#device-local-state)).

## Shared configuration

`$XDG_CONFIG_HOME/labshelf/config.json` (default `~/.config`) is shared by the apps and the bridge. `libraryRoot` is the one store of the library root. The terminal lets an explicit option or environment variable override it; VS Code and the bridge read and write only `libraryRoot`. Writers keep keys they do not own.
