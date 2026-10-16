sha: 632d371
files: packages/core/src/writing/typst/**, packages/core/src/writing/backlinks/sourceHeadings.ts, packages/core/src/writing/project/roots/rootDetection.ts, packages/core/src/writing/latex/source/**, packages/vscode/src/writing/latexEditing/outline/**, packages/vscode/src/writing/typst/tinymist/**
source: one Explore scout, 2026-10-16, session 4 start

# Sections, Typst headings and the outline

- Typst heading regex exists only in `core/src/writing/backlinks/sourceHeadings.ts:10-25` (`/^[ \t]*=+[ \t]+(.+?)[ \t]*(?:<label>)?[ \t]*$/u`, returns `{line,title}`), with no comment or raw-block handling. A new scanner replaces it.
- Typst comment regex `TYPST_COMMENT` is module-private in `core/src/writing/project/roots/rootDetection.ts:10-11` (TRAP: lookbehind keeps `https://`); it deletes comments, so offsets shift. No raw-block stripping exists. The LaTeX analogue `latex/source/scan/stripComments.ts` blanks comments to spaces (same length).
- LaTeX: `scanLatexSource(text).sections: SectionFact[]` (`latex/source/facts.ts:9-37`): `{command, level (part -1 … subparagraph 5), starred, title, range: LatexRange}`, zero-based line/character.
- `vscode/src/writing/latexEditing/outline/sectionSymbols.ts:1-35` maps sections to `DocumentSymbol`s: `KIND_BY_LEVEL[level+1]`, name `title || "(untitled)"`, full range up to the next section with `level <= this.level`, nesting by a stack. `registerSectionOutline.ts:7-16` registers for `**/*.tex`, only for files where `sources.projectOf(uri)`.
- `core/src/writing/typst/` root: index + 5 files, plus `node/`. Its index is the `@labshelf/core/typst` entry, kept out of the root barrel.
- Tinymist: `vscode/src/writing/typst/tinymist/tinymistExtension.ts:4-8` — `TINYMIST_ID`, `tinymistInstalled(): boolean`.
- Tests: `core/__tests__/writing/typst/*.test.ts` (e.g. `typstProblems.test.ts`); `vscode/__tests__/writing/latexEditing/outline/sectionSymbols.test.ts` with `support/latexProjectFixtures` and `support/textDocument` `fakeDocument`.
- `vscode/src/writing/outline/` does not exist.
