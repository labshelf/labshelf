sha: 8967fae7
files: packages/core/src/writing/**, packages/vscode/src/writing/check/**, packages/vscode/src/writing/versions/**, packages/vscode/src/writing/bibliography/**
source: Explore scout, 2026-10-16 (refresh for 2f)

# Writing core pieces to reuse

- Cites: `citedKeys(format: ProjectFormat, text: string): CitedKey[]` `citations/citationKeys.ts:55-57` (`CitedKey {key,start,end}` :19-24, offsets, `*` dropped); `scanCitationKeys(format,text): string[]` :60-62. `LATEX_CITE_COMMAND` exported :7 allows up to two `[..]` optional args, so `\cite[p.~4]{k}` matches; only the page text is not captured. `citationSites` `backlinks/citationSites.ts:31`; `keysOnLine(format, source: SourceLine)` `review/citedKeysAt.ts:23` (also `citedKeysAt` :37).
- Cite text: `citations/citedText.ts` (25 lines): `pageSupplement(format, page): string` :14-16 (`p.~4` LaTeX, `p. 4` Typst); `quotationBefore(format, text)` :19-25.
- Bib: `bibEntries(text): BibEntry[]` `bibLint/bibEntries.ts:20`; `papersByCiteKey(papers)` `citations/papersByCiteKey.ts:5`; `citationEntries(keys, papers, details = {}): CitationEntry[]` `review/citationEntries.ts:29-35` (one entry per unique key; no library paper gives `{key}`; `CitationDetails {highlights?: Map<paperId, QuotedHighlight[]>, citedIn?: Map<key,string[]>}` :8-11). Bib-only key: compose the three.
- Preprint: `preprintIdsOf`, `publishedVersionLookup`, `publishedEntry`, `lintBibliography` → `BibFinding` with `BibFix`; host `vscode/src/writing/bibliography/`.
- Add to library: `import/identifiers/`; `makeCiteKey`/`uniqueCiteKey` `library/identity/citeKey.ts`; `writePaperRecord` `library/mutations/paperRecordWrite.ts:24`.
- Highlights: `quotedHighlights(annotations, limit): QuotedHighlight[]` `review/quotedHighlights.ts:12-18` (non-empty highlights sorted by page then `createdAt`, sliced); `QuotedHighlight {text; page; color?}` :5-9. TRAP: the `.map` (:17) drops `color`.
- Log: `parseTexLog` `latex/log/parseTexLog.ts`; `explainTexMessage(message, engine): BuildProblem | null` `latex/log/explainTexMessage.ts:128`. `BuildProblem.kind?: "undefinedCitation" | "undefinedReference" | "overfull"` (:9, exported from `latex/log/index.ts`) and `subject?` (cite key or label). Rules: undefined reference :83, citation :86-89, overfull hbox :100-101 (vbox :102 has no kind). `undefinedRefs` `latex/source/project/undefinedRefs.ts:12`.
- Commands: `labshelf.writing.checkBeforeSubmitting` (`runChecks({facts,sources,settings,gitUser})` `checks/runChecks.ts:19`), `labshelf.writing.markVersion`, `labshelf.writing.compareVersions`.
- Counting: `countWords` `latex/source/words/countWords.ts`; `collectProjectSources`; `paperBody` in `checks/`; `pageLimitFindings(body, totalPages, settings?)` `checks/pdfRules.ts:10`. `countUpTo: "end"` counts all pages; default counts pages before References.
- Settings: `labshelf.yaml` via `project/projectFile.ts`, `userKeys.ts`. `check:` holds `pages`, `words`, `countUpTo` (`CountUpTo`), `authors`, `anonymous`. `CheckLimits {pages, words, countUpTo}` and `ProjectSettingsPatch.check?` (undefined deletes the key, empty `check:` removed) are writable via `ProjectDataPort.updateProjectSettings`.
- Outline: `sourceHeadings(format,text)` `backlinks/sourceHeadings.ts:13`. SyncTeX: `writing/synctex/` (`pointFor`, `sourceAt`). Typst cites: `review/pdfCitationTargets.ts`.
- Missing: key suggestion, bib→library, export, `\includeonly`.
- TRAP: `labshelf.bib` is generated; a trimmed bib must not write it.
