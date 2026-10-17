sha: 18723264 (plus uncommitted work)
files: see library-shell.md, writing-data.md, vscode-host.md, all-projects-page.md
source: planning thread, 2026-10-17, from the four scout entries

# Mockup element -> data

E = exists, D = derivable, M = missing. "Session" = what the host knows in this VS Code session only.

## Header and columns

| Element | Status | Source |
|---|---|---|
| "All projects 5" count | E | `placeCounts(rows)` (derive) |
| Search "/", New menu | E | `allProjectsHeader.ts`, `mountAllProjects.ts:28-34` |
| Pane toggle | E | `togglePane` + `icon("panel-right")` (`header/listHeader.ts:25,47`) |
| Title | E | `ProjectRow.title` |
| Venue · days chip | M | needs `target.venue`, `target.deadline` in labshelf.yaml (Q1) |
| Engine TEX/TYP | E | `ProjectRow.format`, `formatLabel` |
| Cites count | D | distinct keys from `citedKeys` over the collected sources |
| Unresolved cites | D | cited keys with no library paper (`papersByCiteKey`) and no entry in any `.bib` of the project |
| Build dot | D (session) | `BuildOutcomes.last(folder)` ok/failed + warnings from `RootBuilds` problems; hollow when no outcome and no PDF; muted when a PDF exists but no build ran this session |
| Modified "2 h" | E | `ProjectRow.modified` + `compactTime` |
| Open items column | dropped | not in the mockup; `ProjectRow.openItems` and its sort key are deleted |

## Tray

| Element | Status | Source |
|---|---|---|
| Type label, name | E | `TrayEntry.type/name` |
| Role label | D | `TrayEntry.fact.label`: Main (`ProjectRow.main`), Bibliography (`settings.bibliography ?? labshelf.bib`), Contents (folder holding an included source), Last build (log) |
| Main fact "8 pages · 2 warnings · overfull …" | D (session) | detail.pages + detail.build |
| Bib fact "12 entries written from the library · synced 2 h ago" | D | entries parsed from the bib file; "written from the library" only for the generated labshelf.bib; time = file mtime |
| Folder fact "Contents: intro, …" | D | children names from the `files` listing (DOM only) |
| main.log "Last build" row | D | log path in the build cache (`rawLogFile`), LaTeX only, shown only when it exists |
| "+ Add file" row | M (action) | new port `createFile(id, path)` |

## Detail pane

| Element | Status | Source |
|---|---|---|
| Mono title, "…" menu | E | title; existing row menu (`projectMenu.ts`) |
| Meta "LaTeX · main.tex · 8 pages · modified 2 h ago" | D | format, main, PDF page count (`readPdfFacts`), modified |
| "Open in VS Code" | E | `port.open`; label from host (`openLabel`) |
| "Preview" | M (action) | new port `preview(id)`; VS Code opens the project then `labshelf.writing.showPreview` |
| "● 2 warnings" | D (session) | build summary |
| "◎ ICLR 2027 · 41 d" | M | Q1 |
| #tags + | M | Q2 (dropped) |
| Tab Citations N | D | cited keys -> library paper title/authors/year, unresolved flagged |
| Tab Versions N | E | `listVersions` (name, created) |
| Target: Venue | M | Q1 |
| Pages "8 / 9", bar, "1 page left · counted up to …" | D | pages counted as in `pdfRules.ts:11-16` (extracted), `check.pages`, `check.countUpTo` |
| Words "5,120" | D | `wordsUpTo(sources, countUpTo)`, `check.words` |
| Build: Engine | E | `settings.engine` (LaTeX) / `settings.typst` (Typst version) |
| Build: Main, Last build dot + message | E / D (session) | main; first problem message, `at` |
| Build now | M (action) | new port `build(id)`; VS Code calls the builder for that folder, not the active editor |
| Open log | M (action) | new port `openLog(id)`; LaTeX, when the log exists |
| Bibliography N sentence | D | as the tray bib fact |
| Location | E | absolute folder, sidebar folder, external flag |
