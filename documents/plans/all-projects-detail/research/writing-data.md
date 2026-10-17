sha: 18723264
files: packages/core/src/writing/**, documents/contracts/library-format.md
source: Explore scout, 2026-10-17; contract read directly

# Writing data available to a project detail

W = `packages/core/src/writing`.

- **labshelf.yaml**: `ProjectSettings` + `parseProjectFile`, `updateProjectFile`, `ProjectSettingsPatch` in `W/project/projectFile.ts`; user keys (`figures`, `values`, `ignore`, `check: CheckSettings {pages?, words?, countUpTo?, authors?, anonymous}`) in `W/project/userKeys.ts`; `CheckLimits {pages, words, countUpTo}` in projectFile.ts. Engine `tectonic|xelatex|pdflatex|lualatex` (LaTeX only); `typst` = compiler version of the last Typst build. Contract: `documents/contracts/library-format.md#labshelfyaml` (lines ~89-146), including "LabShelf writes check.pages… from the preview… A malformed folder, archived, … key makes the file fail to parse". No venue, deadline or tags.
- **Build results** (in memory only): `LatexBuildResult` (`W/latex/build/buildResult.ts`): cancelled | succeeded{pdf, problems: LocatedProblem[]} | failed{problems}; `TypstBuildResult` (`W/typst/typstBuildResult.ts`). `BuildProblem` (`W/latex/log/explainTexMessage.ts`) `{severity error|warning|info, message, hint?, file?, line?, kind?, subject?}`. Log parse `W/latex/log/parseTexLog.ts`, `readTexLog.ts`. No persisted outcome, no timestamp type.
- **Pages**: `W/checks/node/readPdfFacts.ts` (pdf.js, `PdfFacts.pages` per page); `W/checks/pdfRules.ts:11-16` computes pages counted (`totalPages` vs `body.contentPages`, `body.headingFound`) only inside the pages rule.
- **Words**: `wordsUpTo(sources, countUpTo)` in `W/checks/limits/wordsUpTo.ts` (stops at `\bibliography`, `\printbibliography`, `#bibliography`).
- **Sources**: `collectProjectSources(main, {read})` (`W/latex/source/project/collectProjectSources.ts`): main first, then includes depth-first, `files[].path`; LaTeX only (Typst lists the main file).
- **Citations**: `citedKeys(format, text)` (`W/citations/citationKeys.ts`), `projectCitationKeys(folder, format, open?)` (`W/citations/node/projectBibliography.ts`), `papersByCiteKey(papers)` (`W/citations/papersByCiteKey.ts`). `updateProjectBibliography` (projectBibliography.ts:51) writes labshelf.bib; format in `W/citations/bibliographyFile.ts`. `lintBibliography` (bibLint) is duplicate/missing-doi/published-version only. Undefined cites appear as `BuildProblem.kind = "undefinedCitation"` after a build.
- **Versions**: `listVersions(folder, logger): Promise<ProjectVersion[]>` (`W/versions/node/listVersions.ts`, oldest first), `VersionInfo {slug, name, created}`.
- **Open items**: `Checklist.openCount` (`W/checklist/buildChecklist.ts`); `PageOverflow {pages, limit}` there too.
- **Venue/deadline**: none anywhere. `documents/plans/writing-2-submission-tools/plan.md` Q1 rejected venue *presets for limits*; it says nothing about a user-entered venue and deadline. That plan's open session 01 (rebuttal) owns `documents/contracts/library-format.md`.
- **Project tags**: none.
