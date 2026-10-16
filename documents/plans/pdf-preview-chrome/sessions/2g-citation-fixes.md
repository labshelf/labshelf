# Session 2g — Citation fixes: key suggestion, Replace, Update, Add to library

- **Goal:** Citation card entries carry one fix, and the host applies it to the source or the library.
- **Starts from:** plan approved; wave-1 protocol and card UI committed
- **Ends with:** A9 host side (wired later by 3a): **A9** Card actions: Replace (undefined key), Update to <venue> (preprint), Add to library (bib-only) each edit the source or library and mark the PDF stale.
- **Owns:** `packages/core/src/writing/citations/fixes/`, `packages/core/src/writing/citations/index.ts`, `packages/vscode/src/writing/preview/citationFixes/` (new), their tests

Context: D10 — the undefined-key suggestion ranks shelf cite keys by edit distance and author/year overlap in core; Replace edits the `\cite` in the source through a WorkspaceEdit. Update edits the user's `.bib`, never `labshelf.bib`. `writing/citations/` already holds 8 files, so new code goes in `fixes/`. Source edits mark the PDF stale through the stale tracker (`vscode/src/writing/preview/stale/`) by themselves. Provides seam S10 (`withCitationFixes`, `fixCitation`) to session 3a. Research: `research/writing-core.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2g.1 | Core `suggestKey` ranking | behaviour | implementer (opus), test first | unit tests pass | [ ] |
| 2g.2 | Host `withCitationFixes` and `fixCitation` (Replace, Update, Add) | behaviour | implementer (sonnet), test first for `fixCitation` source edits | host tests pass | [ ] |
| 2g.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 2g.1 — Key suggestion

- **Goal:** for an undefined key, return the best shelf cite key or none.
- **Read only:** `packages/core/src/library/identity/citeKey.ts:1-62` (key shape: author, year, word); `packages/core/src/writing/citations/papersByCiteKey.ts` (whole); `packages/core/src/writing/citations/index.ts`.
- **Decided:** `fixes/suggestKey.ts`: `suggestKey(missing: string, keys: readonly { key: string; authors: string[]; year?: string }[]): string | undefined`; score = normalised edit distance on the key + bonus for matching first-author surname and year parsed from `missing`; threshold so unrelated keys return none; ties by key ascending. Export from `fixes/index.ts` and `citations/index.ts`.
- **Done when:** table tests: typo, swapped year, different author → none, tie order. `pnpm --filter @labshelf/core test` on the new tests passes.
- **Do not touch:** other files in `writing/citations/`.

## 2g.2 — Fix handlers (A9)

- **Goal:** the host decorates citation entries with their one fix and applies a fix the reader sends.
- **Read only:** `packages/core/src/reader/previewProtocol.ts:27-80` (`CitationEntry`, `CitationCardFix`); `packages/core/src/reader/previewRequests.ts:20-24` (`CitationFix`); `packages/core/src/library/mutations/paperRecordWrite.ts:1-60`; `packages/vscode/src/writing/bibliography/` (grep `publishedEntry`, `BibFix`); `packages/vscode/src/writing/preview/citations/previewCitations.ts:1-87` (the deps it gets).
- **Decided:** `citationFixes/withCitationFixes.ts`: `withCitationFixes(deps, entries): Promise<CitationEntry[]>` — no paper and no bib → `replace` with `suggestKey` when one exists; a preprint whose published version is known → `update`; bib only → `add`. `citationFixes/fixCitation.ts`: `fixCitation(deps, project, fix)`: replace edits the key inside the `\cite` at `file:line` with a `WorkspaceEdit` (only that key, other keys of the command kept); update applies the existing `BibFix` to the user's `.bib`; add imports by DOI/arXiv when the bib entry has one, else writes a record from the bib fields with `uniqueCiteKey`. Every failure logs through the injected `ILogger` and shows a message. Export both from a `citationFixes/index.ts`.
- **Done when:** host tests per fix kind with fakes, including a multi-key `\cite` (only the one key changes); `pnpm --filter @labshelf/vscode test` on `writing/preview` passes.
- **Do not touch:** `preview/citations/**`, `previewPorts.ts`, `writing/bibliography/**`.
