# Session 2f — Citation card: data and UI

- **Wave:** 2, runs together with 2a–2e, 2g–2i
- **Starts from:** wave 1 committed
- **Ends with:** A8 (card fields, page-first highlights, Open at p. N / Go to source); fix buttons render from `entry.fix` fixtures (fixes are 2g's)
- **Owns:** `packages/core/src/reader/dom/hover/citations/**`, `packages/core/src/writing/citations/citationKeys.ts`, `packages/core/src/writing/review/{citationEntries,quotedHighlights}.ts`, `packages/vscode/src/writing/preview/citations/**`, `packages/core/src/reader/dom/styles/reader.css`, `packages/core/src/reader/dom/styles/citation-card.css` (new), their tests
- **Research:** research/writing-core.md, research/ui-kit.md, research/mockup.html
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6. Use `ui-design` for 2f.2. A new export from `writing/citations/index.ts` (2g's) is not allowed: keep changes inside existing exports, or report.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2f.1 | Card data: `[p.~N]`, REF/BIB, folder, site, page-first highlights | behaviour | implementer (sonnet) | tests pass | [ ] |
| 2f.2 | Card UI from the mockup, fix buttons from `entry.fix` | behaviour | implementer (sonnet) | jsdom tests pass | [ ] |
| 2f.3 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 2f.1 — Card data

- **Goal:** `lookupCitation` answers each entry with `paper` or `bib`, `site`, `citedPage`, and highlights ordered cited page first (colour only, D2).
- **Read only:** `core/src/writing/citations/citationKeys.ts:1-62` (extend the LaTeX cite pattern to capture `[p.~N]`); `core/src/writing/citations/citedText.ts:1-20` (`pageSupplement`); `core/src/writing/review/citationEntries.ts:1-35`; `core/src/writing/review/quotedHighlights.ts:1-18`; `core/src/reader/previewProtocol.ts:27-80`; `vscode/src/writing/preview/citations/previewCitations.ts:1-87`, `sourceLineAt.ts:1-19`.
- **Decided:** `citedKeys` results gain optional `page?: number` (no new export). `CitationEntry.site` = the citing command at the queried place (file project-relative, line, text). Highlights: those on `citedPage` first, the rest after, each keeps `color`; no meaning label. `bib` filled from the user's `.bib` when no library paper has the key. Leave `fix` unset (2g decorates entries; 3a composes).
- **Done when:** core tests for `[p.~4]`, `[p.~4]` with a second optional arg, ordering; vscode `preview/citations` tests; all pass.
- **Do not touch:** `writing/citations/index.ts`, other `writing/citations/*` files, `previewPorts.ts`.

## 2f.2 — Card UI (A8)

- **Goal:** the card reads authors · year, REF/BIB tag, title, venue · folder, `file:line · \cite…`, highlights (cited page, then the rest folded), actions Open at p. N / Go to source, and one fix row when `entry.fix` is set.
- **Read only:** `core/src/reader/dom/hover/citations/citationCard.ts:1-65`, `citationTabs.ts:1-65`, `previewCitations.ts:1-57`; `core/src/reader/dom/styles/reader.css:200-234` (card rules to move); `research/mockup.html:142-166` (`.pop`), `:371` (`showPop`).
- **Decided:** move the `.rd-cite-*`/`.rd-hover-cite*` rules out of `reader.css` (300 lines, at the limit) into `citation-card.css`, `@import`ed from `reader.css`. Fix row: `replace` → "Replace with `<suggestion>`", `update` → "Update to <venue>", `add` → "Add to library"; click posts `{command:"fixCitation", fix: {kind:"replace", key, replacement, file, line} | {kind, key}}` through `ctx.host.post`. "Go to source" posts `openSourceLine` with `site`. Library reader (no preview) renders as today.
- **Seams:** consumes the `fixCitation` request (protocol); S10 fills `fix`.
- **Done when:** jsdom tests per fix kind and highlight folding; core `reader` tests pass; `reader.css` ≤ 300 lines.
- **Do not touch:** `startup/**`, `preview/**`.
