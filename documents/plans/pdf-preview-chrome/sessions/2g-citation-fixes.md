# Session 2g — Citation fixes: key suggestion, Replace, Update, Add to library

- **Wave:** 2, runs together with 2a–2f, 2h, 2i
- **Starts from:** wave 1 committed
- **Ends with:** A9 host side: entries get a `fix`, and `fixCitation` edits the source or library; wired by 3a
- **Owns:** `packages/core/src/writing/citations/fixes/` (new), `packages/core/src/writing/citations/index.ts`, `packages/vscode/src/writing/preview/citationFixes/` (new), their tests
- **Research:** research/writing-core.md
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6. `writing/citations/` holds 8 files: new code goes in `fixes/`. Source edits mark the PDF stale through 2a's tracker by themselves.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2g.1 | Core `suggestKey` ranking (D10) | behaviour | implementer (opus), test first | unit tests pass | [ ] |
| 2g.2 | Host `withCitationFixes` and `fixCitation` (Replace, Update, Add) | behaviour | implementer (sonnet) | host tests pass | [ ] |
| 2g.3 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 2g.1 — Key suggestion

- **Goal:** for an undefined key, the best shelf cite key or none.
- **Read only:** `core/src/library/identity/citeKey.ts:1-62` (key shape: author, year, word); `core/src/writing/citations/papersByCiteKey.ts` (whole); `core/src/writing/citations/index.ts`.
- **Decided:** `fixes/suggestKey.ts`: `suggestKey(missing: string, keys: readonly { key: string; authors: string[]; year?: string }[]): string | undefined`; score = normalised edit distance on the key + bonus for matching first-author surname and year parsed from `missing`; threshold so unrelated keys return none; ties by key ascending. Export from `fixes/index.ts` and `citations/index.ts`.
- **Done when:** table tests: typo, swapped year, different author → none, tie order.

## 2g.2 — Fix handlers (A9)

- **Goal:** the host decorates citation entries with their one fix and applies a fix the reader sends.
- **Read only:** `core/src/reader/previewProtocol.ts:27-80` (`CitationEntry`, `CitationCardFix`); `core/src/reader/previewRequests.ts:20-24` (`CitationFix`); `core/src/library/mutations/paperRecordWrite.ts:1-60`; `vscode/src/writing/bibliography/` (grep `publishedEntry`, `BibFix`); `vscode/src/writing/preview/citations/previewCitations.ts:1-87` (deps it gets).
- **Decided:** `citationFixes/withCitationFixes.ts`: `withCitationFixes(deps, entries): Promise<CitationEntry[]>` — no paper and no bib → `replace` with `suggestKey` when one exists; a preprint whose published version is known → `update`; bib only → `add`. `citationFixes/fixCitation.ts`: `fixCitation(deps, project, fix)`: replace edits the key inside the `\cite` at `file:line` with a `WorkspaceEdit` (only that key, other keys of the command kept); update applies the existing `BibFix` to the user's `.bib` (never `labshelf.bib`); add imports by DOI/arXiv when the bib entry has one, else writes a record from the bib fields with `uniqueCiteKey`. Every failure logs and shows a message.
- **Seams:** provides S10.
- **Done when:** host tests per kind with fakes, including a multi-key `\cite`; vscode `writing/preview` tests pass.
- **Do not touch:** `preview/citations/**` (2f), `previewPorts.ts`, `writing/bibliography/**`.
