# Session 1a — Core foundations: icons, tokens, time, status mark

- **Wave:** 1, runs at the same time as [1b-data.md](1b-data.md)
- **Starts from:** plan approved (Q1 settled); D8 done (`research/mockup/` holds site/ and light/dark screenshots)
- **Ends with:** A2 (marks in rows), A3, A21 for touched packages; Q3 answered in log.md
- **Commit:** yes, at the end of the session, owned files only
- **Research:** icons.md, tokens.md, data.md

## Owns
`core/src/ui/icons/`, `core/src/ui/tokens/`, the generated `core/src/ui/dom/tokens.css` and `vscodeHost.css`, `core/src/library/format/`, `core/src/library-ui/dom/list/paperRow.ts`, `rowCells.ts`, `core/src/library-ui/dom/styles/library-list.css`, their mirrors under `core/__tests__/`, `LICENSE-lucide.md`, the icons bullet of `documents/architecture.md`.
**Do not touch:** `derive/`, the protocol, `documents/contracts/` (1b owns them).

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1a.1 | Scout Q3: do scanner, sync and browser IndexedDB carry extra files and subfolders of a paper folder | — | M · Explore | answer in log.md | [x] |
| 1a.2 | Lucide glyphs, stroke 1.5, missing glyphs, licence, architecture.md | — | M · implementer | icon tests pass | [x] |
| 1a.3 | New tokens + host map + contrast pairs | — | H · main thread (ui-design), then M · implementer | A21 | [x] |
| 1a.4 | Compact relative time; status dot/arc cell in list rows | 1a.2 | M · test-writer, then implementer | A2, A3 | [x] |
| 1a.5 | Verify, finish, commit | 1a.1–1a.4 | `verify` (headless browser page, light + dark), `finish`, `commit-splitter` | gate passes | [x] |

## 1a.1 — Q3 scout
- **Do:** check the library scanner, sync ([sync.md](../../../contracts/sync.md)) and the browser IndexedDB store for files other than paper.pdf, metadata.yaml, bib.bib inside a paper folder, and for subfolders. Record yes/no per layer with file:line in log.md.
- **Touch:** log.md only.

## 1a.2 — Lucide icons
- **Do:** replace `STROKE_GLYPHS` geometry in `core/src/ui/icons/glyphs.ts` with Lucide (hand-copied; Feather names stay where Lucide renamed); stroke 1.5 in `icon.ts`; drop hard-coded 2.5 dot strokes; add folder-open, sort arrow or chevron, open-to-side. Add a licence notice (Lucide ISC + Feather MIT) at the repo root or next to glyphs.ts; update [architecture.md#design-system](../../../architecture.md#design-system).
- **Touch:** `core/src/ui/icons/`, licence file, architecture.md. **Do not touch:** `website/`, `arcMark.ts` geometry.
- **Test first:** n/a (geometry); existing icon tests stay green.

## 1a.3 — Tokens
- **Design (done, plan D5):** surface tokens `row-zebra`, `row-open`, `button-soft-bg`, `button-soft-hover` are `color-mix(in srgb, var(--ls-fg|--ls-focus) N%, transparent)` with N = 3, 7, 16, 24, no host-map entry; `button-soft-fg` dark `#66b1f3` / light `#0c589f`, mapped to `color-mix(in srgb, var(--vscode-textLink-foreground) 80%, var(--vscode-foreground))`, PAIRS on `bg`. New brand group `FILE_TYPE_TOKENS` (unmapped, rendered like `MARK_TOKENS`): `file-pdf` `#d9837c`/`#b84a42`, `file-md` `#7d9fe0`/`#4069b8`, `file-ref` = file-md values, `file-dir` `#d2a865`/`#946618`; each in PAIRS on `bg` at 4.5:1 (`packages/core/__tests__/ui/dom/tokenContrast.test.ts`). Remaining: one Sonnet implementer.
- **Do:** add zebra bg, open-paper tint, soft-button bg/fg/hover (mapped in `vscodeHostMap.ts`) and file-type pdf, md, ref, attachment (brand, unmapped, opaque hex, `tokenContrast` PAIRS). Run `pnpm --filter @labshelf/core tokens`; never hand-edit the generated CSS.
- **Touch:** `core/src/ui/tokens/`, generated css, `core/__tests__/ui/`.
- **Test first:** contrast pairs for the four file-type tokens.

## 1a.4 — Time and status mark
- **Tests written (failing):** `__tests__/library/format/compactTime.test.ts`, `__tests__/library-ui/dom/list/rowCells.test.ts`. The status cell is built in `library-ui/dom/list/paperRow.ts:46,:55`; keep a `[data-cycle]` element (wireMain relies on it). Decision: the Last read title keeps the page, `Last read <toLocaleString()>, page N` — adjust the new rowCells test and keep `rowMarks.test.ts:27`, change only its `:26` text to "3 h". Delete `relativeTime` and its test if nothing else uses it.
- **Do:** compact formatter ("1 d", "3 w") in `core/src/library/format/`; full date as tooltip; Last read cell uses it; status cell renders dot (Unread) or `arcMark` (Reading, Done) with an accessible name, Alt 1/2/3 unchanged. Delete the long `relativeTime` if nothing else uses it (grep every package).
- **Test first:** formatter boundaries (minutes, days, weeks, months, years); row cell names the status.
- **Done when:** A2, A3.

## 1a.5 — Verify, finish, commit
- **1a.2 to look at:** the screenshots must show the Lucide glyphs, especially `library` (bookshelf), `tag` (filled dot), `file-no-text` (composite: Lucide file + text lines + slash) and `open-to-side` (square-split-horizontal); grep consumer CSS that sizes icons for the old stroke.
- **Commit:** `core/src/ui/icons/{glyphs.ts,icon.ts,LICENSE-lucide.md}`, `core/__tests__/ui/icons.test.ts`, `documents/architecture.md` (only the icons bullet; the file may hold other sessions' edits), plus the 1a.3 and 1a.4 files. Do not commit `arcMark.ts`/`icons/index.ts` (`STATUS_ARC` belongs to another session) unless 1a.4 uses it, then ask the user first.
- Headless page per memory `webview-smoke-test-headless-chromium`; compare with `research/mockup/`.
