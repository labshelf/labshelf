sha: 18723264 (plus uncommitted work)
files: packages/core/src/writing/checks/**, packages/core/src/writing/citations/**, packages/core/src/writing/allProjects/node/**
source: planning thread, 2026-10-17 (decided, not scouted)

# Decided node reader

Types are in data-shapes.md.

- `countedPages(facts, countUpTo): { pages; headingFound }` extracted from `writing/checks/pdfRules.ts:11-16` into its own file in `writing/checks/`; the pages rule uses it unchanged.
- `projectCitations.ts`: sources from the main via `collectProjectSources` (Typst: main only); distinct `citedKeys`; resolve via `papersByCiteKey` (`library`, title, authors "Surname et al." past two, year), else keys of any root `*.bib` and the bibliography file (`bib`; reuse a BibTeX key reader from `writing/citations/` if one exists), else `none`. `readProjectCites(folder, settings, papers): Promise<{cites; unresolved}>`.
- `readProjectDetail({id, folder, settings, papers, build, pdf?, log?}, logger)`: engine = `settings.engine` (LaTeX) or `"Typst " + settings.typst`; pages + counted pages from `readPdfFacts(pdf)` + `countedPages`; counted words from `wordsUpTo` on the sources; limits from `settings.check` (`countUpTo` default `references`); `log` = basename when the file exists; bibliography = `settings.bibliography ?? "labshelf.bib"` when it exists (entries, `generated` = first line is the generated-file comment of `bibliographyFile.ts`, `written` = mtime); versions from `listVersions`, newest first. A failing part logs WARN with the folder and is left out.
- Exported through `allProjects/node/index.ts` and `packages/core/src/node/index.ts`.
