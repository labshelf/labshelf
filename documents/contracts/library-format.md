# Contract: library format

Read when you change a file the library stores on disk, the device-local files, the shared configuration or how conflict copies are merged.

A library is a folder the user owns, moved between devices by their sync tool. Every app, and any older or newer version of it, reads and writes the same files, so a name, a key or a rule here cannot change without breaking libraries already on disk. The file rules of [code.md](../code.md#files) apply to every file below.

## Layout

```
<library root>/
  papers/<folder>/…/<paper id>/    the user's folders, any depth; a folder holding metadata.yaml is a paper
    metadata.yaml  paper.pdf  bib.bib (generated)  and the user's attachments, kept and moved with the paper
    notes.qmd                      the paper's notes, see qmd-items.md; created empty with the paper
  projects/<project id>/           a folder holding labshelf.yaml is a project
  templates/<template id>/         My templates, see templates.md
  spaces/<space id>/               see spaces.md
  kits/                            deck Kits, see decks.md#kits
  home.json                        the personal Home desk, see Home below
  .research/
    papers/<paper id>/data.json    the sidecar; synced
    reader-themes.json             the user's custom reader themes, shared by every paper; synced
    tmp/ staging/ templates/       scratch the apps rebuild; the user may exclude them from sync
    sources/arxiv/<arxiv id>       cached arXiv e-prints; rebuildable
```

The browser without a folder keeps the same tree in IndexedDB under the same relative paths.

An empty `notes.qmd` is a paper without notes. Older versions kept the notes at `.research/papers/<paper id>/notes.qmd`; each app, after its first index on library open, moves such a file into the folder of the paper the index holds: as is when the paper folder has no `notes.qmd` or an empty one, deleted when both hold the same text, and otherwise beside the paper folder's file as a `.labshelf-conflict-<UUID>` copy, which the item-file merge folds in ([Conflict copies](#conflict-copies)). A file whose paper the index does not hold is left in place. The same pass gives every indexed paper an empty `notes.qmd` it lacks.

## Paper identity

- The paper id is the folder name and equals the cite key. It never changes, also when the paper moves. The sidecar is keyed by id and the notes live in the paper folder, so annotations and notes follow the paper and a move orphans nothing.
- A new id is `authorYearWord` (`vaswani2017attention`). The surname comes only from a registry record or the PDF's XMP, never from a guess. A new id never collides, case-insensitively, with any paper or folder. Existing ids are never regenerated.
- When two papers share a cite key, the smallest id wins in every lookup.

## metadata.yaml

The source of truth for a paper; every paper list is rebuilt from it. Each key belongs to one action, and every other rewrite keeps it, so actions never clobber each other:

- A metadata refresh never touches `status` or `tags`, which are the user's.
- `pdfVersion` belongs to writing `paper.pdf`: set, or removed when the new version is unknown.
- `pdfRequestedAt` belongs to the request-a-copy action. It holds a day; the author's address is never stored.
- `statusChangedAt` belongs to a status change to a different value.
- `trashedAt` (ISO timestamp) belongs to the Trash actions: Move to Trash sets it, Restore removes it, and Delete Forever deletes the folder. Absent means not trashed; it syncs like every metadata key.
- `files` (name to description) belongs to the action that describes files, which also drops names missing on disk.
- `hasPdf` is derived on each device and never written.

`metadata.yaml` and `bib.bib` are written together.

## labshelf.yaml

A writing project is a folder with `labshelf.yaml`, under `projects/` or registered anywhere else on the device.

- `id` is the project's identity, unique case-insensitively among the device's projects, and never changes. Renaming writes `title` only.
- A shared project syncs `format`, `main`, `engine`, `bibliography`, `typst`, `title`, `figures`, `values`, `check`, `target`, `papers` and `libraryFolders`. `id`, `folder`, `archived`, `trashed` and `shared` stay per user ([collaboration.md](collaboration.md)).
- `figures.<path>.run` is a shell command. It runs only after the user confirms that exact command on that machine, never because a synced file says so.
- `papers`: entries with `cited: true` belong to LabShelf, which adds and removes them as the sources cite library papers. Entries without it are the user's and are never removed. The user's entries that name a library paper are written into `labshelf.bib` whether cited or not. A rewrite keeps only `key`, `doi` and `cited`.
- `libraryFolders`: a list of library folder paths (the segments under `papers/` joined by `/`), which LabShelf writes when the user links or unlinks a folder. Subfolders are included, and every paper in them is written into `labshelf.bib` whether the sources cite it or not; only cited keys reach `papers`. A member of a shared project who does not have a linked folder contributes no entries for it.
- LabShelf writes the keys it owns, `libraryFolders`, `check.pages`, `check.words`, `check.countUpTo` and `target.*`, and never writes `figures`, `values` or other `check` keys. A malformed optional key fails the parse, naming the key, and a file that does not parse is never rewritten.
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
libraryFolders: [ml/optimization]
```

## Generated files

LabShelf owns these in a project. The first line says so, and edits are overwritten.

- `labshelf.bib`: one entry per cited key that matches a library paper, plus one per library paper the user listed in `papers` and one per paper of the project's `libraryFolders`, whether cited or not, without `file`. A Typst main that already calls `#bibliography` is left alone. In a shared project see [collaboration.md](collaboration.md#bibliography).
- `labshelf-values.tex`: LaTeX projects with `values:`. Defines `\lsvalue{<file>.<path>}` for each JSON leaf. The main file gets `\input{labshelf-values}` once.

## Project folder: `.labshelf/`

Files that travel with a project.

- `checklist.json`: the Checklist's hand-added items. Item ids are unique and never reused. Tasks written in the project's notes are derived from the note files and never stored here ([qmd-items.md](qmd-items.md#project-notes)).
- `comments.qmd`: comment threads on the project's text files, one item per comment ([qmd-items.md](qmd-items.md#comments)), anchored by a quote with 32 characters of context on each side. Ids are unique and never reused. A thread whose quote is found nowhere stays listed as detached. It also holds the pending suggestions, after the threads: the text file already holds each suggested text, an insert's item quotes the inserted text and a delete's item keeps the deleted text, and an accepted or rejected suggestion's item is removed. In a shared project the share writes the file from its `comments` and `suggestions` maps and the anchor also holds `start` and `end` ([collaboration.md](collaboration.md#comments)).
- `versions/<slug>/`: a named snapshot (`version.json`, the built `paper.pdf`, `sources/`). The same slug replaces the version. A snapshot is built in a hidden `.<slug>.tmp-*` folder and renamed, so a sync tool never uploads a half snapshot; hidden folders are ignored. `version.json` comes from other machines, so an invalid one skips the folder.
- `writes/<device id>.json`: each device's record of the versions it wrote, read by every device to find divergent versions. A device writes only its own file, so devices never conflict on it. Timestamps in it are not an order across devices.
- `mirror-lease.json`: see [collaboration.md](collaboration.md#mirror-ownership).
- `state.json` is per device and is not read.

Beside `.labshelf/`, in the project folder, `notes/<slug>.qmd` holds the project's notes, as item files ([qmd-items.md](qmd-items.md#project-notes)).

## Sidecar: `data.json`

Annotations, theme, reading position and view mode of one paper. The annotation types are `highlight`, `comment` and `tag`; the paper's notes live in `notes.qmd` ([qmd-items.md](qmd-items.md)).

- Every app writes identical bytes for the same state (key order `annotations`, `theme`, `reading`, `view`, `deleted`; `reading` omitted until first opened, `view` omitted until the reader changes it, `deleted` omitted while empty and sorted by `id`), so two apps never make the sync tool see a conflict.
- `theme` is a preset (`auto`, `light`, `dark`, `sepia`, `high-contrast`) or `custom:<id>`, a theme of `reader-themes.json`. A custom ref whose theme is missing or deleted reads as `auto`; the file is not rewritten for it.
- `view` is `{"scroll": "vertical" | "horizontal" | "wrapped", "spread": "none" | "odd" | "even"}`. It is kept apart from `reading`, which every position save replaces.
- Highlights may carry `style: "underline"` to draw a line beneath the text; absent means a filled highlight.
- Annotation positions are normalised to the page (0..1), so any app and zoom reads them.
- Removing an annotation leaves a `deleted` marker. Without it a stale copy of the file from another device would bring the annotation back. Markers are dropped after 90 days, so a copy older than that can bring an annotation back; every app keeps them at least that long.
- Copies merge per annotation, the larger `updatedAt` winning; a marker removes its annotation unless the annotation was edited after it. `theme`, `reading` and `view` follow the newer file.

## Reader themes: `reader-themes.json`

The custom reader themes, one list for the whole library, so every app and paper offers the same ones.

```json
{
  "themes": [
    { "id": "c-k3x9a0qz", "name": "Night", "page": "#101820", "ink": "#e0e0e0", "updatedAt": "2026-10-30T12:00:00.000Z" }
  ]
}
```

- `id` is `c-` and 8 lowercase base36 characters; `page` and `ink` are lowercase `#rrggbb`; `name` is 1 to 40 characters.
- Every app writes identical bytes: themes sorted by `id`, keys in the order shown, `deleted` last and only on tombstones, two-space indent.
- Deleting a theme leaves a tombstone (`"deleted": true`, newer `updatedAt`) so a stale copy cannot bring it back. Per `id` the larger `updatedAt` wins.
- An entry with a bad id, colour, name or date is ignored on read; a file that is not JSON reads as empty.
- The reader derives its chrome (surfaces, borders, text) from `page` and `ink`, and falls back to the light or dark preset's shadow and find colours by the page's luminance.

## Home: `home.json`

The user's personal Home desk, one file at the library root, synced with the library and never shared.

```json
{
  "version": 1,
  "desk": [
    { "kind": "paper", "ref": "<paper id>" },
    { "kind": "space", "ref": "<space id>" },
    { "kind": "note", "space": "<space id>", "ref": "notes/<name>.qmd" },
    { "kind": "task", "id": "1a2b3c4d", "title": "Email the advisor", "description": "About chapter 2", "date": "2026-11-10", "link": { "kind": "project", "ref": "<project id>" } }
  ]
}
```

- `kind` is `paper`, `project`, `space` (a `ref` id), `note` or `thread` (a `ref` path inside the Space `space`), or `task`. A task has an 8-hex `id`, a `title`, and optional `description`, `date` (YYYY-MM-DD) and `link` (`kind` `paper`, `project` or `space`, and `ref`).
- Order is the order on the desk. The desk holds at most 8 entries: pinning or adding past it is refused, and pinning what is already pinned changes nothing. Completing a task removes it.
- A missing file is an empty desk. Unknown keys and entries this version cannot read are kept and written back after the valid ones; a higher `version`, or a `desk` that is not a list, makes the file read-only. A file that is not JSON is not overwritten.
- A pin whose target is gone stays on the desk as missing until it is unpinned.

## Device-local files

What belongs to one device lives outside the library, because a sync tool would copy it to devices where it is wrong or make conflict copies of it.

- Each library has a folder named by its library key: the first 16 hex characters of the SHA-256 of the normalised root (absolute, symlinks resolved, Windows drive letter upper case) so VS Code and the terminal derive the same key. Moving the library gives it a new key.
- The cache side (`$XDG_CACHE_HOME/labshelf`, else the platform default) holds only what is rebuilt: the text index and the OpenAlex citation cache. The cache is rebuilt when it grows stale or a paper's DOI changes, and a cache file that is incomplete reads as missing.
- The state side (`$XDG_STATE_HOME/labshelf`, else the platform default) holds the `device-id` UUID, `projects.json` (absolute paths of project folders registered outside the library; removing a project never removes the folder), `merge-bases/`, `conflict-dismissals.json`, `collab/` ([collaboration.md](collaboration.md)), `shares.json` ([share-link.md](share-link.md)), `mirror.json` and the logs.
- `mirror.json` is VS Code's mirror hash table for [remote library](remote-library.md): `{"version": 1, "relayUrl": string, "rows": {<row path>: {hash, size, kind}}}`, what this device last pushed to the relay. A file that does not parse reads as missing, and a change of relay URL (rotation, reconnect) resets the table; either way the next run pushes every row again. Turning Remote access off deletes the file.
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

## Code listings

"Insert code" copies code from a file into a manuscript as a listing, between two comments that record where it came from, so the copy can later be compared with the file.

```latex
% labshelf:code analysis/fit.py#fit_model @3f2a9c01b7de
\begin{minted}{python}
def fit_model(x, y):
    ...
\end{minted}
% labshelf:code end
```

- The opening comment is a line of its own: `% labshelf:code <path>[#<anchor>] @<hash>` in LaTeX, `// labshelf:code …` in Typst. The closing comment is `% labshelf:code end` (`//` in Typst). An opening comment that does not match, or has no closing comment before the next opening one, is ignored and the listing is not tracked.
- The path is POSIX and relative to the project folder; it may climb out of it with `../`. A space, `#` and `%` in it are written `%20`, `%23` and `%25`.
- The anchor is absent for the whole file, `L<start>-L<end>` for lines (1-based, inclusive), or the dotted name of a function or class (`fit_model`, `Model.fit`). Names are found in Python (`def`, `class`, with their decorators), R (`name <- function`) and Julia (`function`, `macro`, `struct`, `module` and one-line `f(x) = …`); other files link by lines or whole. When a name is defined more than once the anchor is the first definition.
- Between the comments sits one listing: `\begin{minted}{<lexer>}` when the project loads minted, else `\begin{lstlisting}` (with `[language=…]` when listings knows the language), and a raw block of three or more backticks in Typst. The user may change the environment line and its options; only the lines between it and its closing line are the code.
- The hash is the first 12 lowercase hex characters of the SHA-256 of the normalised code: LF line breaks, trailing spaces and blank first and last lines removed, and the indentation every line shares removed.
- A listing is in one of the five states of [manuscript links](qmd-items.md#manuscript-links), comparing the recorded hash with the manuscript's code and the file's current code: `fresh`, `stale`, `diverged`, `both` or `missing` (the file or the name is gone, or the lines are past its end). A file the app cannot read (outside the library folder in the browser) gives no state and no mark.
- A file outside the workspace folders is read only after the user picked it on this machine (Browse… in Insert code, or Insert into Manuscript… from that file); the picks are kept per machine, never in the project. Any other outside path gives no state and no mark, and the file is never read.
- A line anchor follows its code: while the manuscript's copy is unchanged and that exact code is still in the file at other lines, the listing is `stale` with the new lines, and its update rewrites only the opening comment.
- Update rewrites the opening comment and the code between the environment lines, keeping both environment lines, and only for `stale`.
- The writing checklist lists `stale`, `diverged`, `both` and `missing` listings under References, beside the equations from notes.
