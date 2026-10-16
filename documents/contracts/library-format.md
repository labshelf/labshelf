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
  projects/                        writing projects created by LabShelf (not synced)
    <project id>/                  one folder per project; the folder name is the project id
      labshelf.yaml                required: a folder holding it is a project
  .research/                       hidden, owned by the apps
    papers/<paper id>/data.json    the sidecar (synced, namespace "appdata")
    projects.json                  project folders registered outside the library (never synced)
    index.sqlite                   VS Code's text index for the Related tab: chunk embeddings and the content hash of each indexed PDF (never synced)
    logs/app.log                   VS Code log (JSON lines)
    logs/terminal.log              terminal log (JSON lines)
    sync/google-drive.*            sync coordination (see sync.md, never synced)
```

Each log file is append-only. Past 2 MiB it moves to `<name>.log.1` (one rotated file is kept, overwritten on the next rotation).

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

Rules:

- Unknown keys are preserved on rewrite.
- `hasPdf` is never written. Each app derives it from the presence of `paper.pdf`.
- An app writes only the keys it owns in that action. A metadata refresh does not touch `status`, `tags` or `note` (see [sync.md](sync.md#coordination-between-local-apps)).
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
  authors: [Jane Doe]
```

| Key | Type | Notes |
|---|---|---|
| `id` | string | required; unique, case-insensitively, among the library's projects and the registered ones |
| `format` | `latex` \| `typst` | required |
| `main` | string | main file, relative to the project folder; when absent, the first root `.tex` file declaring `\documentclass` (`main.tex` first, then alphabetical), or `main.typ` |
| `engine` | `tectonic` \| `xelatex` \| `pdflatex` \| `lualatex` | LaTeX only |
| `bibliography` | string | the bibliography file the main file loads, `labshelf.bib` by default; written once the main file loads it |
| `typst` | string | Typst compiler version of the last successful Typst build, written after each one; a YAML number reads as its text |
| `figures` | mapping | figure path → `{run, inputs}`; `run` is the shell command that makes the figure, run in the project folder; `inputs` lists paths or globs (`*`, `**`, `?`). A figure is stale when it is missing or an input is newer than it |
| `values` | string[] | JSON files whose leaves the sources read: `\lsvalue{<file>.<path>}` in LaTeX, `json("…")` in Typst. `<file>` is the file name without `.json`, and of two files with the same name only the first is read; array items are numbered from 0 |
| `check` | mapping | what the pre-submission check holds the built PDF to: `pages` is the most pages allowed before the references heading (every page counts when the PDF has none); `authors` lists names an anonymous submission must not show, besides the git user's and the PDF's Author field; the anonymity rules run unless `anonymous` is `false`, as for a camera-ready |

LabShelf never writes `figures`, `values` or `check`. A malformed one makes the file fail to parse, with the key in the reason. A `run` command executes only after the user confirms it on that machine; the confirmation covers that project and that exact command.

Rules:

- A new id is the title folded to lowercase ASCII, with every run of other characters turned into one hyphen; `project` when nothing is left. A registered folder takes its folder name as the title. Collisions take the paper suffixes (`a` to `z`, then `aa`, …).
- Rewrites change only the keys being set and keep the user's comments, key order and unknown keys.
- A `labshelf.yaml` that does not parse is never rewritten.
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
