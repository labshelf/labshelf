# Contract: library format

Read when you change a file the library stores on disk or the shared configuration.

A LabShelf library is a folder that the user owns. Every app reads and writes this format, and the sync engine moves it between devices. Changing a file name, a key or a serialization rule here changes the contract for every app and for libraries already on disk.

## Layout

```
<library root>/
  papers/                          visible, user-organised, synced (namespace "library")
    <folder>/<folder>/…            the user's folders, any depth
      <paper id>/                  one folder per paper; the folder name is the paper id
        paper.pdf                  optional
        metadata.yaml              required: a folder holding it is a paper
        bib.bib                    BibTeX entry generated from metadata.yaml
        <any other file or folder> the user's attachments; kept, moved and synced with the paper
  projects/                        writing projects created by LabShelf (synced, namespace "projects")
    <project id>/                  one folder per project; the folder name is the project id
      labshelf.yaml                required: a folder holding it is a project
  templates/                       My templates, see templates.md (not synced)
    <template id>/                 one folder per template; the folder name is the template id
      template.yaml                required: a folder holding it is a template
  .research/                       hidden, owned by the apps
    papers/<paper id>/data.json    the sidecar (synced, namespace "appdata")
    projects.json                  project folders registered outside the library (never synced; the folders themselves sync in namespace "projects")
    openalex/                      OpenAlex citation data for the citation map (never synced)
    staging/                       a project install (<project id>/) or a template save (template-*/) in progress, renamed into projects/ or templates/ when complete (never synced)
    templates/                     Community and Typst Universe indexes and thumbnails, see templates.md (never synced)
    index.sqlite                   VS Code's text index for the Related tab: chunk embeddings and the content hash of each indexed PDF (never synced)
    logs/app.log                   VS Code log (JSON lines)
    logs/terminal.log              terminal log (JSON lines)
    sync/google-drive.*            sync coordination (see sync.md, never synced)
```

Each log file is append-only. Past 2 MiB it moves to `<name>.log.1` (one rotated file is kept, overwritten on the next rotation).

A paper folder may hold any other files and subfolders. Apps never delete or rewrite them, and moving or removing the paper takes them along. The apps list a paper's direct entries in its file tray and hide `metadata.yaml`, `bib.bib` and names starting with "." there.

The browser stores the same tree in IndexedDB under the same relative paths. `papers/…` maps to the `library` namespace, and `appdata/<paper id>/data.json` maps to `.research/papers/<paper id>/data.json`.

IndexedDB holds only files, so an empty folder is a zero-byte `.keep` file inside it.

## Paper identity

- The paper id is the name of its folder and equals its cite key. It never changes when the paper moves between folders.
- A new id is generated from the paper's metadata and must not collide, case-insensitively, with an id already in the library. Existing ids are never regenerated.
- The id has the form authorYearWord: the first author's surname, the year and the first title word that is not a stopword, each reduced to lowercase ASCII letters and digits (`vaswani2017attention`).
- The surname comes only from trusted authors: a registry record or the PDF's XMP packet. Authors guessed from the page layout or the Info dictionary give no surname, so the id is yearWord (`1986downloaded`). A missing year or title word is left out the same way.
- When nothing is left, the id is `paper` followed by the import's millisecond timestamp.
- On a collision, the id takes BibTeX's suffixes: `a` to `z`, then `aa`, `ab`, and so on. A folder that exists on disk without being a known paper counts as taken.
- The sidecar is keyed by id, not by folder path, so moving a paper never orphans its annotations.

## metadata.yaml

`metadata.yaml` is the source of truth for a paper's record. Every paper list (the in-memory library store in VS Code and the terminal, IndexedDB in the browser) is rebuilt from it.

| Key | Type | Notes |
|---|---|---|
| `title` | string | falls back to the id |
| `citekey` | string | falls back to the id |
| `path` | string | the paper folder as the writing app saw it; informational, apps locate papers by scanning |
| `source` | string | the file name the user imported |
| `authors` | string[] | |
| `year` | number | |
| `status` | `unread` \| `reading` \| `done` | anything else reads as `unread` |
| `summary` | string | the abstract |
| `journal`, `publisher`, `volume`, `issue`, `pages`, `doi`, `url`, `issn`, `language` | string | |
| `keywords` | string[] | from the paper or the metadata source |
| `tags` | string[] | the user's labels |
| `note` | string | the user's note |
| `textLayer` | `{state, ocrPages?, failedPages?, reason?}` | whether the PDF has selectable text |
| `pdfVersion` | `preprint` \| `accepted` \| `published` | which version `paper.pdf` is, when its source said so; absent or anything else reads as unknown |
| `pdfRequestedAt` | `YYYY-MM-DD` string | the day the user asked the author for a copy; absent or anything else reads as never requested |
| `statusChangedAt` | ISO timestamp string | when `status` last changed; absent or anything else reads as unknown |
| `files` | mapping of string → string | the user's description of each entry of the paper folder, keyed by its name (one path segment); an entry whose value is not a non-empty string is ignored, and a name with no matching entry is shown nowhere |

Rules:

- Unknown keys are preserved on rewrite.
- `hasPdf` is never written. Each app derives it from the presence of `paper.pdf`.
- An app writes only the keys it owns in that action. A metadata refresh does not touch `status`, `tags` or `note` (see [sync.md](sync.md#coordination-between-local-apps)).
- `pdfVersion` belongs to the action that writes `paper.pdf`: attaching or replacing the PDF sets it, or removes it when the new file's version is unknown. Any other rewrite keeps it.
- `pdfRequestedAt` belongs to the action that opens the request email. Any other rewrite keeps it, and the address the request went to is never stored.
- `files` belongs to the Describe action, which sets or removes one name and removes the key when no name is left. Any other rewrite keeps it, renaming or deleting a file does not touch it, and the next Describe on the paper drops names missing on disk.
- `statusChangedAt` belongs to the action that changes `status`: it is set whenever the new status differs from the old one. Setting the same status again, creating a paper and any other rewrite keep it.
- `bib.bib` is regenerated whenever `metadata.yaml` is written. One core service writes both. Its `file` field points at `paper.pdf` only when that file exists.

## labshelf.yaml

A writing project is a folder with `labshelf.yaml` at its root. It lives either under `projects/` or anywhere else on the device, registered in `.research/projects.json`.

```yaml
id: deep-nets-survey
format: latex
main: main.tex
engine: tectonic
bibliography: labshelf.bib
typst: 0.14.2
figures:
  fig/ablation.pdf:
    run: python plot_ablation.py
    inputs: [plot_ablation.py, results/*.json]
values: [results.json]
check:
  pages: 9
  words: 8000
  countUpTo: references
  authors: [Jane Doe]
target:
  venue: NeurIPS 2027
  deadline: 2027-05-15
papers:
  - key: smith2020
    doi: 10.1000/xyz123
    cited: true
  - key: doe2019
ignore: [data/raw/**, "*.log"]
```

| Key | Type | Notes |
|---|---|---|
| `id` | string | required; unique, case-insensitively, among the library's projects and the registered ones |
| `format` | `latex` \| `typst` | required |
| `main` | string | main file, relative to the project folder; when absent, the first root `.tex` file declaring `\documentclass` (`main.tex` first, then alphabetical), or `main.typ` |
| `engine` | `tectonic` \| `xelatex` \| `pdflatex` \| `lualatex` | LaTeX only |
| `bibliography` | string | the bibliography file the main file loads, `labshelf.bib` by default; written once the main file loads it |
| `typst` | string | Typst compiler version of the last successful Typst build, written after each one; a YAML number reads as its text |
| `folder` | string | the sidebar folder the project sits in, segments joined by `/`; absent at the top level |
| `archived` | boolean | `true` hides the project from My projects and lists it in the All projects tab; `false` reads as absent |
| `title` | string | the name shown for the project; the shown name is `title`, or `id` when `title` is absent or blank. Renaming writes `title` and never changes `id` or the folder, because `id` is the Drive identity of the project ([sync.md](sync.md#projects)) |
| `trashed` | string | ISO 8601 time since which the project is in the trash; restoring removes the key. Trash and restore leave `archived` as it is, so a restored project returns to where it was. A trashed project still syncs: the key syncs like any other |
| `figures` | mapping | figure path → `{run, inputs}`; `run` is the shell command that makes the figure, run in the project folder; `inputs` lists paths or globs (`*`, `**`, `?`). A figure is stale when it is missing or an input is newer than it |
| `values` | string[] | JSON files whose leaves the sources read: `\lsvalue{<file>.<path>}` in LaTeX, `json("…")` in Typst. `<file>` is the file name without `.json`, and of two files with the same name only the first is read; array items are numbered from 0 |
| `check` | mapping | what the pre-submission check holds the built PDF to: `pages` is the most pages allowed, counted as `countUpTo` says; `authors` lists names an anonymous submission must not show, besides the git user's and the PDF's Author field; the anonymity rules run unless `anonymous` is `false`, as for a camera-ready |
| `check.words` | positive integer | the most words allowed, counted up to the same point as `pages` |
| `check.countUpTo` | `references` \| `end` | where `pages` and `words` stop counting: `references` (the default when absent) stops at the references heading, and every page counts when the PDF has none; `end` counts the whole document |
| `target` | mapping | where the project is headed: `venue` is the venue it is written for (text) and `deadline` its submission deadline, a calendar date as `YYYY-MM-DD` without a time; All projects shows the days left. An impossible date such as `2027-02-30` is malformed, and a `target` with neither key reads as absent |
| `papers` | `{key, doi?, cited?}`[] | the papers the project depends on; `key` is the cite key. LabShelf lists every key the sources cite that matches a library paper with `cited: true` and takes the DOI from the library paper with that cite key; an entry without `cited` is one the user added (Add to Reading List). A cited key with no library paper, such as a Typst label or a key from the user's own `.bib`, is not added, and an entry already listed for it stays while it is cited. Sync adds new cited entries in key order after the existing ones, fills a missing DOI from the library, never changes or removes a DOI already listed, and removes a `cited: true` entry once the sources stop citing the key; entries without `cited` are never removed, and Add to Reading List on a `cited: true` entry drops the flag. `labshelf install` imports the listed papers it cannot find in the library under their listed `key`. A rewrite of the list keeps only `key`, `doi` and `cited`; `cited: false` reads as absent |
| `ignore` | string[] | paths that project sync leaves on the device, as patterns relative to the project folder with `*`, `**` and `?` like `figures` inputs; a pattern that matches a folder covers everything under it ([sync.md](sync.md#projects)) |

LabShelf writes `check.pages`, `check.words` and `check.countUpTo` from the preview, removes a limit the user clears and drops `check` when that leaves it empty. It writes `target.venue` and `target.deadline` from the All projects detail pane, removes a key the user clears and drops `target` when that leaves it empty. It never writes `figures`, `values`, `ignore` or the other `check` keys. A malformed `folder`, `archived`, `title`, `trashed`, `figures`, `values`, `check`, `target`, `papers` or `ignore` makes the file fail to parse, with the key in the reason. A `run` command executes only after the user confirms it on that machine; the confirmation covers that project and that exact command.

Rules:

- A new id is the title folded to lowercase ASCII, with every run of other characters turned into one hyphen; `project` when nothing is left. A registered folder takes its folder name as the title. Collisions take the paper suffixes (`a` to `z`, then `aa`, …).
- Rewrites change only the keys being set and keep the user's comments, key order and unknown keys.
- A `labshelf.yaml` that does not parse is never rewritten.
- Deleting a project forever removes its folder from the device when it is under `projects/`, and only unregisters it when it is a registered folder, leaving its files. The Drive copy stays: a project missing locally never deletes anything on Drive ([sync.md](sync.md#projects)).
- Registering a folder writes `labshelf.yaml` when the folder has none and touches nothing else in it. A folder inside the library cannot be registered.

## labshelf.bib

LabShelf owns this file in a writing project and regenerates it from the cite keys the project's sources cite.

- The first line is the generated-file comment; edits are overwritten.
- Entries are in key order, built from library metadata without a `file` field.
- A key matches a paper's cite key case-sensitively. When two papers share a cite key, the smallest paper id wins.
- A cited key with no library paper has no entry; it is left to the user's own `.bib` file.
- The file is created with the first cited library paper.
- Once the main file loads the file, the main file has the bibliography line and `labshelf.yaml` has `bibliography:`. A Typst main file that already calls `#bibliography` is left to the user.

## labshelf-values.tex

LabShelf owns this file in a LaTeX project with `values:`. It is written next to the main file before each build.

- The first line is the generated-file comment; edits are overwritten. The file is rewritten only when its text changes.
- It defines `\lsvalue{<key>}`, which prints the leaf's value, or `??` with a LaTeX warning when the key is unknown.
- Each JSON leaf (number, string, boolean) becomes one key: `<file>.<path>`, dot-separated. Strings are escaped for LaTeX. A key with a character outside letters, digits, `.`, `-` and `_` is skipped.
- The main file gets `\input{labshelf-values}` before `\begin{document}`, once. A main file without `\begin{document}` is left as it is, and the build logs a warning.

## .research/projects.json

The device's list of project folders outside the library. Absolute paths differ per machine, so it is never synced.

```json
{
  "folders": ["/abs/path/to/project"]
}
```

- Paths are absolute, kept in the order they were added, each at most once.
- Unknown keys are preserved on rewrite. A file that is not a JSON object is never overwritten: projects outside the library stay hidden until the user fixes or deletes it.
- Removing a project from LabShelf removes its entry and never deletes the folder.
- A project may contain `.labshelf/state.json`, a per-device file that never syncs ([sync](sync.md#projects)); LabShelf does not read it.

## .research/openalex/

The citation map's cache of OpenAlex works. It can be rebuilt from OpenAlex at any time, so it is never synced; the browser keeps it under the same relative path in IndexedDB.

- `papers/<paper id>.json` holds the work a library paper's DOI resolved to; `works/<work id>.json` holds a work that library papers cite.
- Each file is `{ "fetchedAt": "<ISO timestamp>", "doi": "<DOI looked up>", "work": { "workId": "W…", "doi", "title", "authors": [], "year", "citedByCount", "references": ["W…"] } }`. `doi` at the top is present only under `papers/`, and `references` is empty under `works/`.
- An entry older than 30 days, or a paper entry whose `doi` differs from the paper's current DOI, is fetched again. A DOI OpenAlex does not return leaves no file.
- A file that is not valid JSON or lacks `fetchedAt`, a `W<digits>` work id, or the `authors` and `references` arrays reads as missing and is overwritten on the next fetch.

## .labshelf/checklist.json

A project's Checklist keeps the items its users add by hand in `<project>/.labshelf/checklist.json`. Coauthors share them, so the file syncs with the project.

```json
{
  "items": [
    { "id": "k3v9q2", "text": "Ask Ana for the ablation numbers", "done": false, "createdAt": "2026-10-16T09:12:00.000Z" },
    { "id": "p81xza", "text": "Shorten the abstract", "done": true, "createdAt": "2026-10-14T18:03:00.000Z", "doneAt": "2026-10-15T10:40:00.000Z" }
  ]
}
```

- `id` is a non-empty string, unique in the file, and never reused. `text` is a non-empty string. `done` is a boolean. `createdAt` and `doneAt` are ISO timestamps; `doneAt` is present only while `done` is true.
- `group` is optional: the By kind group the item sits in, one of `"todo"`, `"ref"`, `"figure"`, `"pages"` or `"reading"`. Without it, or with any other value (kept on rewrite), the item sits in My items.
- `section` is optional: the By section group id (a non-empty string of at most 200 characters) the item sits in. Without it, or when invalid (kept on rewrite), the item sits in Whole project; an id that matches no section shows the item in Whole project too. In By kind the item sits in My items unless it has a `group`.
- A missing file reads as no items.
- An item with a missing or invalid key is not shown and is kept unchanged on rewrite. Unknown keys, at the top level and in items, are preserved on rewrite.
- A file that is not a JSON object with an `items` array is reported and never overwritten.
- Two devices that edit the file offline produce a conflict copy, as for any project file ([sync.md](sync.md#three-way-diff)); no item is lost.

## .labshelf/versions/

A version is a named snapshot of a project: its sources and its built PDF at the moment the user marked it (for example "submitted", "rebuttal" or "camera-ready"). Versions live inside the project folder and are synced with it.

```
<project>/.labshelf/versions/<slug>/version.json
<project>/.labshelf/versions/<slug>/paper.pdf
<project>/.labshelf/versions/<slug>/sources/…
```

```json
{ "name": "Camera-ready", "created": "2026-10-15T21:40:12.000Z" }
```

- `<slug>` is the name in lowercase ASCII: accents are removed, every run of characters outside `a-z` and `0-9` becomes one `-`, leading and trailing `-` are trimmed, and the result is cut to 60 characters. A name with no letter or digit has no slug and cannot be marked.
- `sources/` holds the project's files at their relative paths, without hidden folders (`.labshelf/`, `.git/`) and without the built PDF, which is `paper.pdf`.
- `version.json` is validated on read, because it arrives from other machines: `name` is a non-empty string and `created` an ISO 8601 timestamp. A folder whose file is missing or invalid is skipped.
- Marking a name whose slug exists replaces that version. A snapshot is written to a hidden `.<slug>.tmp-*` folder and renamed into place, so readers never see a half-written version; hidden folders are ignored.

## Sidecar: `data.json`

The sidecar holds per-paper state from the reader: annotations, the reader theme and the last reading position.

```json
{
  "annotations": [ { "id": "…", "paperId": "…", "type": "highlight", "pageNumber": 3,
                     "content": "…", "color": "yellow",
                     "position": { "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.02 },
                     "createdAt": "…", "updatedAt": "…" } ],
  "theme": "auto",
  "reading": { "page": 6, "scaleValue": "page-width", "left": 0, "top": 512,
               "sidebar": { "open": true, "tab": "outline", "width": 240 },
               "updatedAt": "…" }
}
```

- Every app writes the exact same bytes: this key order, two-space indent, and `reading` omitted until the paper is first opened. Two apps writing different bytes for the same state would cause sync conflicts.
- `theme` is one of `auto`, `light`, `dark`, `sepia`, `high-contrast`.
- An annotation `color` is one of `yellow`, `green`, `blue`, `red`, `pink`.
- `position` is normalised to the page: every value is in 0..1, width and height are positive, and the box stays inside the page.
- `scaleValue` is a pdf.js preset (`page-width`, `page-fit`, `page-actual`, `auto`) or a number in (0, 64] written as a string. `left` and `top` are in PDF points from the top-left of the page.
- Reading is defensive. A corrupt or hand-edited sidecar never throws: invalid fields fall back to their defaults, and annotations without an `id` are dropped.

## Shared configuration

`~/.config/labshelf/config.json` (respects `XDG_CONFIG_HOME`) points the local apps at the library:

```json
{ "version": 1, "libraryRoot": "/abs/path/to/library", "terminal": { … } }
```

`libraryRoot` is the single store of the library root. The terminal resolves the library in this order: `--library`, then `LABSHELF_LIBRARY`, then `libraryRoot`. VS Code reads only `libraryRoot` and writes it when a library is configured. Every writer keeps the keys it does not own and writes atomically (temporary file, then rename).
