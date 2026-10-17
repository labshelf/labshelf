# What LabShelf really does (scouted 2026-10-17)

Source of truth for the website copy, recordings and tutorials. Verify one detail in the code (`file:line` given) before showing it, when it is marked "unverified".

## Not real: never show these

- Highlight "meanings" (Key claim, Method, Definition, Doubt). The real annotation colours are yellow, green, blue, red and pink (`packages/core/src/model/annotation.ts:13`).
- `labshelf check`, `ls --cited-by`, `labshelf cite`, `labshelf export`, and the `in:` filter.
- `npm i -g @labshelf/cli`. Nothing is published.
- A local port (7319) between the browser and VS Code.
- `notes.md` and `highlights.json` in the paper folder.
- `\citep` output, and a "Cite p.~4" button.
- A "Related" chat or LLM assistant. The AI setting only drives a local semantic index.
- These settings: `labshelf.library.path`, `cite.keyPattern`, `latex.command`, `latex.bibFile`, `ai.provider`, `backup.path`.

## Packages and install

- VS Code: `packages/vscode`, publisher `labshelf`, version 0.0.1, VS Code ^1.98. It is not published. The manifest name is scoped `@labshelf/vscode`, so the marketplace id is unsettled. The site shows "build from source" and a GitHub link.
- Terminal: `@labshelf/terminal`, bin `labshelf`, Node ≥ 22.6, private. Install by running `pnpm --filter @labshelf/terminal build` and linking `dist/labshelf.mjs` as `labshelf` (`documents/apps/terminal.md` "Build and run").
- Browser: `@labshelf/browser`, private, for Chrome/Chromium 125+ and Firefox 128+. Chrome loads it unpacked from `dist/chrome`. Firefox takes it as a temporary add-on or a signed xpi (`documents/apps/browser.md`). It needs Google OAuth credentials before the first build.
- Repo: https://github.com/lucaanasser/labshelf

## Library on disk (`documents/contracts/library-format.md`)

```
<root>/papers/<folders…>/<paper id>/   paper.pdf (optional), metadata.yaml, bib.bib (generated), attachments
<root>/projects/<project id>/labshelf.yaml
<root>/.research/papers/<id>/data.json  highlights and annotations
<root>/.research/{index.sqlite, logs/, sync/, openalex/}
```

- The paper id is the cite key, in the form authorYearWord, for example `vaswani2017attention`.
- `metadata.yaml` holds title, authors, year, status (unread, reading or done), tags, note, doi and more.
- The note lives in `metadata.yaml`, under the detail pane's Notes tab.

## VS Code

- **Library:** the LabShelf activity bar container, with Library, Projects and the Settings gear. "Research: Open List Tab" opens the list and detail pane.
- **Status:** a click on the status mark cycles it.
- **Search syntax** (`packages/core/src/library/search/syntaxHelp.ts:9-16`):
  - `tag:nlp` or `#nlp`, `status:reading` or `is:r`;
  - `year:2015..2020` or `year:>2018`;
  - `author:`, `kw:`, `note:`, `venue:`, `key:`, `abstract:`;
  - `has:pdf`, `no:pdf`.
- **Adding papers:** the list header has an "Add" button. Commands: "Research: Add Paper" and "Research: Add Paper by DOI or Link…", which takes a DOI, arXiv id, PMID, PMCID or article link. PDFs can be dragged from the OS onto the sidebar. Dropping onto the list is unverified.
  - Metadata comes from Crossref, arXiv and OpenAlex, merged by per-source trust.
  - OCR: "Research: Make Scanned Paper Searchable (OCR)".
- **Reader:**
  - The selection bubble has five buttons titled "Highlight <colour>" and "Copy with citation" (Cmd/Ctrl+Shift+C).
  - The quote format comes from `labshelf.reader.citationStyle`: pandoc (the default), latex, author-year or citekey. latex gives ``` ``quote'' \cite[p.~4]{key} ```.
  - Hovering a reference shows a card (`labshelf.reader.hoverPreviews`, `hoverDelayMs` 250).
  - Keys: Cmd/Ctrl+= and Cmd/Ctrl+- zoom, Cmd/Ctrl+0 resets the zoom, Cmd/Ctrl+F finds, Alt+Left/Right moves through history (Cmd+[ and Cmd+] on Mac), F4 toggles the sidebar.
  - The Notes tab has "Insert highlights" and "Copy note". "Research: Export Annotations to Markdown" exports highlights; its grouping is unverified.
- **Writing (LaTeX and Typst projects):**
  - Preview: "Research: Show Preview". Cmd/Ctrl+Enter builds, and Cmd/Ctrl+Alt+J shows the source line in the preview (LaTeX only). Typst compiles in WASM.
  - Citation card actions: "Replace with <suggestion>", "Update to <venue>" for a preprint that has been published, and "Add to library". The `.bib` lint offers "Replace with the published version".
  - F8 and Shift+F8 move to the next and previous problem, inside the preview.
  - The footer holds page and word limits (`check.pages`, `check.words`, `check.countUpTo` in `labshelf.yaml`).
  - Builds one chapter through `\includeonly`. Exports an arXiv bundle (`packages/vscode/src/writing/export/exportBundle.ts`).
  - Typing `\cite[` lists a paper's highlights and inserts `\cite[p.~4]{key}`. "Cite from Library" is the command version.
  - `labshelf:key#p5` links open the reader.
  - "Research: Check Before Submitting" checks the page limit, anonymity, Type 3 fonts and low-resolution images.
  - Views: Versions ("Mark Version", "Compare Versions"), and Figures, which detects stale figures.
  - Templates: "Research: Browse Templates…" and a blank project.
  - "Install Project Papers" imports the papers a project lists.
- **Other features:**
  - Citation Map: works that at least 3 library papers cite and the library lacks.
  - Related tab, fed by the local semantic index.
  - Sync: "Sync: Connect to Google Drive", "Sync: Sync Now" and "Sync: Disconnect from Google Drive".
- **Settings:**

  | Setting | Default |
  |---|---|
  | `labshelf.sync.autoSyncIntervalMinutes` | 15 |
  | `labshelf.ai.enabled` | true |
  | `labshelf.ocr.enabled` | true |
  | `labshelf.ocr.makeSearchable` | true |
  | `labshelf.ocr.maxPages` | 150 |
  | `labshelf.ocr.languages` | ["eng"] |
  | `labshelf.reader.vimKeys` | false |
  | `labshelf.reader.defaultZoom` | page-width (others: page-fit, page-actual, auto) |
  | `labshelf.reader.toolbarAutoHide` | true |
  | `labshelf.reader.restorePosition` | true |
  | `labshelf.reader.hoverPreviews` | true |
  | `labshelf.reader.hoverDelayMs` | 250 |
  | `labshelf.reader.citationStyle` | pandoc |
  | `labshelf.reader.openBeside` | false |
  | `labshelf.writing.autoCompile` | true |

## Terminal (`packages/terminal/src/cli/usage.ts`, `ui/keymap.ts:35-118`)

- **CLI:** `labshelf` with no arguments opens the TUI.
  - Commands: `ls [collection] [-r] [--json] [--sort key[!]]`, `search <query…>`, `show`, `add <pdf|folder|url|doi|arxiv|pmid>… [--to <collection>]`, `bib [id…] [-c coll] [-o file.bib]`, `open <id|key|labshelf:key#pN>`, `status <id…> unread|reading|done`, `tag <id…> +tag -tag`, `mv`, `copy`, `install [project-dir]`, `sync`, `auth login|logout|status`, `init [path]`, `where`, `doctor`.
  - `--json` works on `ls`, `search`, `show` and `sync`.
  - Environment variables: `LABSHELF_LIBRARY`, `LABSHELF_PDF_VIEWER`, `LABSHELF_IMAGES=iterm`.
- **TUI** (folders | papers | preview):
  - Movement: `j`/`k`, `h`/`l`, `gg`/`G`, `tab` for the preview tabs (Info, Abstract, Notes, BibTeX).
  - Finding: `f` filters, `/` finds, `s` searches the library, `z` and `Z` jump to a folder or paper.
  - Status: `mu`, `mr` and `md` mark Unread, Reading and Done.
  - Papers: `t` tags, `e` edits the note in $EDITOR, `a` adds.
  - Copy: `yk` the key, `yc` `\cite{}`, `yb` BibTeX, `ym` highlights as Markdown.
  - `B` exports a .bib, `S` syncs, `?` shows help.
  - Thumbnails need kitty, Ghostty, iTerm2 or WezTerm.
- Edits made in the terminal show up live in VS Code.

## Browser

- **How it works:** the extension keeps its own library in IndexedDB and syncs through the same Google Drive folder as the other apps. Capture runs the core import chain (DOI, arXiv, PMID, landing page, Unpaywall). It supports library proxies and custom resolvers.
- **Visible surfaces:**
  - Toolbar popup: save form, "Already in your library", and an "Attach to <paper>" PDF offer.
  - Library page: sidebar, list, reader, Citation Map.
  - Options page.
  - Google Scholar button, which shows "In LabShelf" for papers already saved.
  - "Find Published Version" for preprints, and PDF offers for downloaded PDFs.

## Privacy: real network hosts

- api.crossref.org, export.arxiv.org, api.openalex.org, api.semanticscholar.org and Europe PMC.
- The Typst Universe and community template indexes.
- Google Drive, only after the user connects it.
- PDF finding and title search send more than an identifier.
