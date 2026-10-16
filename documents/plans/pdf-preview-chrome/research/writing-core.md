sha: be8baf12
files: packages/core/src/writing/**, packages/vscode/src/writing/check/**, packages/vscode/src/writing/versions/**, packages/vscode/src/writing/bibliography/**
source: Explore scout, 2026-10-16

# Writing core pieces to reuse

- Cites: `citedKeys(format,text)` `citations/citationKeys.ts:55` (offsets; `[p.~4]` not captured — extend `LATEX_CITE_COMMAND`); `citationSites` `backlinks/citationSites.ts`; `keysOnLine` `review/citedKeysAt.ts`; `pageSupplement` `citations/citedText.ts:12`.
- Bib: `bibEntries` `bibLint/bibEntries.ts:20`; `papersByCiteKey` `citations/papersByCiteKey.ts:5`; `citationEntries` `review/citationEntries.ts:29` (card data). Bib-only key: compose the three.
- Preprint: `preprintIdsOf`, `publishedVersionLookup`, `publishedEntry`, `lintBibliography` → `BibFinding` with `BibFix`; host `vscode/src/writing/bibliography/`.
- Add to library: identifiers in `import/identifiers/`; `makeCiteKey`/`uniqueCiteKey` `library/identity/citeKey.ts`; `writePaperRecord` `library/mutations/paperRecordWrite.ts:24`.
- Highlights: `quotedHighlights` `review/quotedHighlights.ts:11`; `Annotation` has `pageNumber`, `content`, `color`.
- Log: `parseTexLog` `latex/log/parseTexLog.ts`, `explainTexMessage.ts:77-92` (undefined ref/cite, overfull) — classification unverified; `undefinedRefs` `latex/source/project/undefinedRefs.ts:12`.
- Commands: `labshelf.writing.checkBeforeSubmitting` (`checks/runChecks.ts:19`, `CheckFinding[]`), `labshelf.writing.markVersion`, `labshelf.writing.compareVersions`.
- Counting: `countWords` `latex/source/words/countWords.ts`; `collectProjectSources`; `paperBody`/`pageLimitFindings` in `checks/` (pages before References).
- Settings: `labshelf.yaml` via `project/projectFile.ts`, `userKeys.ts` (`check.pages`); `ProjectDataPort.updateProjectSettings`.
- Outline: `sourceHeadings(format,text)` `backlinks/sourceHeadings.ts:13`.
- SyncTeX: `writing/synctex/` (`pointFor`, `sourceAt`). Typst cites: `review/pdfCitationTargets.ts`.
- Missing: key suggestion, bib→library, export, `\includeonly`.
- TRAP: `labshelf.bib` is generated; a trimmed bib must not write it.
