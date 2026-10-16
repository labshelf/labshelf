# Plan: Flat "All papers" library list

Status: in progress (sessions 6–8a done; session 9 VS Code check next)
Size: G — core list, detail head, side bar and protocol plus wiring in two apps, 6 sessions in 3 waves; grows to GG if Q3 shows sync or IndexedDB must start carrying extra paper files
Pending decisions: 0

## 1. Goal

The library in the VS Code extension and the browser extension looks and behaves like the approved "All papers" mockup ([research/mockup.md](research/mockup.md)): a calm sortable list where the open paper unfolds into its files with one useful fact each, a detail head with the real fields, and a side bar whose folder tree also lists papers and follows the selection. Both apps get it from one set of core components.

## 2. Decisions

Facts: [components](research/components.md), [tokens](research/tokens.md), [icons](research/icons.md), [sidebar](research/sidebar.md), [data](research/data.md), [mockup](research/mockup.md).

Taken with the user:

- [x] **D1** Icons switch to Lucide geometry, hand-copied into `core/src/ui/icons/glyphs.ts` (no dependency); stroke 1.5 set once in `icon.ts`; dot glyphs adjusted; add folder-open (reveal), sort arrow or chevron, open-to-side from Lucide; licence notice (Lucide ISC + Feather MIT) in the repo; [architecture.md#design-system](../../architecture.md#design-system) says Lucide. `website/js/icons.js` stays out.
- [x] **D2** The VS Code side bar stays a native TreeView. Papers become tree nodes (getChildren/getParent), scope rows use the arc-mark tree icons (`vscode/src/ui/arcMarkIcons.ts`), REF is an SVG iconPath with light/dark variants generated from core like the arc marks. The tree-with-papers derivation (scopes with counts, folders then papers) is runtime-neutral core code used by the VS Code provider and the browser's `sidebarTree.ts`.
- [x] **D3** File facts: paper.pdf → latest highlight with page (derived `lastHighlight` in `PaperStats`), else the abstract's first sentence; note → start of `note` in metadata.yaml, "Empty" when none; attachments and subfolders → a user-written description stored per file.
- [x] **D4** Protocol in [library-ui-host.md](../../contracts/library-ui-host.md): host→webview `reveal {id}` (VS Code queues it until the webview is ready); webview→host selection message so the tree marks the selected paper; `lastHighlight` in stats; a pull message for a paper's file listing (name, kind, size, mtime, description); a description write.

Proposed here:

- [x] **D5** Surfaces follow the host, marks stay brand. Zebra (`row-zebra`, fg 3%), open paper (`row-open`, fg 7%) and soft button bg/hover (`button-soft-bg`/`-hover`, focus 16%/24%) are `color-mix` over `--ls-fg`/`--ls-focus`, so they follow the VS Code theme with no map entry; `button-soft-fg` is brand hex mapped to `color-mix(textLink 80%, foreground)`. File-type text `file-pdf` (err tone), `file-md` and `file-ref` (reading tone), `file-dir` (warn tone) are a brand group like `MARK_TOKENS`, opaque hex at 4.5:1 on `bg`; other attachments use `desc`.
- [x] **D6** This plan supersedes the list and detail part of [core-no-pills](../core-no-pills/plan.md): the list status pill becomes the mark, the detail status segment becomes status ⌄. core-no-pills keeps the token deletion and the reader pills, and re-greps before it runs.
- [x] **D7** The description is edited with one action, "Describe…", in the file row's context menu (Shift F10 too), which opens the core quick input with the current text; empty text removes the entry. No inline editor.
- [x] **D8** The mockup's `site/` and reference screenshots (light and dark, All papers and a folder scope) live under [research/mockup/](research/mockup/).

Settled:

- [x] **Q1** The description is stored in a new optional metadata.yaml key `files: { <relative name>: <description> }`. It is additive (unknown keys survive a rewrite, apps write only keys they own) but still a contract change: the keys table, and the paper-folder layout saying a paper folder may hold other files and subfolders, with metadata.yaml hidden in the UI.
- [x] **Q2** Group labels have no twistie and do not fold.

Open:

- **Q3** Do sync and the browser IndexedDB carry extra files and subfolders of a paper folder? Until they do, the browser tray shows paper.pdf and the note only. 1a.1 answers it.

## 3. Scope

- **In:** core library UI (list, groups, file tray, detail head, header path), tokens, icons, tree derivation, protocol; VS Code list webview and native library tree; browser library page and its side bar.
- **Out:** terminal app, website, reader, Projects view; detail tab content beyond the head (keep every field).
- **Contracts touched:** [library-ui-host.md](../../contracts/library-ui-host.md); [library-format.md](../../contracts/library-format.md) (Q1: the `files` key).

## 4. Acceptance criteria

List

- [x] **A1** Column heads are Title, Authors, Year, Last read, Status; clicking one sorts and sets `aria-sort`; a second click flips the order. No Publication column, no chips in the title cell.
- [x] **A2** Status shows Unread as a dot, Reading and Done as arcs, with an accessible name; Alt 1/2/3 sets it.
- [x] **A3** Last read shows compact relative time ("1 d", "3 w"); the full date is in the tooltip.
- [x] **A4** Rows are taller, zebra runs edge to edge, the selection is an accent band, the focus ring shows only after keyboard navigation (`:focus-visible`).
- [x] **A5** With subfolders in scope, the open folder's own papers come first, unlabelled; each subfolder's papers follow under a muted "X › Y › Z" label with a count, one step indented; paths over three segments read "first … last two" with the full path in the tooltip; no folder colour.
- [x] **A6** Opening a paper (Enter, click, left twistie) tones its row one step up and shows its files below as tree-child rows: paper.pdf, the note, other files, subfolders; metadata.yaml never appears.
- [x] **A7** Each file row shows its type in coloured mono and its name, then one fact (D3); size and modified time are in the tooltip.
- [ ] **A8** Hovering or focusing a file row shows open to the side (files only), reveal, copy path, each labelled; "Describe…" stores a description that survives a reload and an older app's metadata rewrite.
- [x] **A9** The header shows Library › … › folder; All papers and the status scopes show no path.
- [x] **A10** Arrow keys move through rows and into the open paper's file rows; Shift F10 opens the row menu; tab order uses a roving tabindex.
- [x] **A11** The list is a treegrid: rows `role=row` with aria-selected and aria-expanded, groups `role=rowgroup` whose label is announced.

Detail head

- [x] **A12** Title, authors, venue line ending "› folder"; Open PDF soft-tinted primary; Cite ⌄ copies in the chosen format; ⋯ in the corner holds the remaining actions.
- [x] **A13** Status ⌄ then #tags in mono with a +; a tag is removable on hover or focus; tabs Details, Annotations, Notes, Related keep every current field.

Side bar

- [x] **A14** Both apps show All papers, Unread, Reading, Done with counts at the top, then folders; each folder lists subfolders, then its papers with a REF mark.
- [x] **A15** Clicking a paper in the tree selects it in the list with its files open, opening its folder and clearing filters if scope or search hid it; the tree marks the selected paper, also when the selection starts in the list.
- [x] **A16** VS Code: a reveal sent before the webview is ready is applied once it is ready.

States

- [x] **A17** Empty library, empty folder and a search with no hits each show their own message.
- [ ] **A18** While the snapshot or a file listing loads, the list shows a loading state; a failure is logged through `ILogger` with context and shown to the user.
- [x] **A19** A long title ellipsizes with a tooltip; at narrow width Last read hides first, then Authors, then Year; the detail pane toggles.
- [ ] **A20** Light and dark match the mockup screenshots in both hosts; VS Code high contrast stays readable.
- [x] **A21** `pnpm -r typecheck` and `pnpm -r test` pass; `tokenContrast` covers every new text token; no file over 300 lines, no directory over 8 source files.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| Lucide glyphs, stroke, licence | `core/src/ui/icons/` + repo licence notice | D1 |
| zebra, open-paper tint, soft button bg/fg/hover | `core/src/ui/tokens/colorTokens.ts` + `vscodeHostMap.ts` | D5; regenerate with `pnpm --filter @labshelf/core tokens`, never hand-edit `tokens.css`/`vscodeHost.css` |
| file-type colours pdf, md, ref, attachment | `colorTokens.ts`, unmapped | opaque hex + `tokenContrast` PAIRS entry each |
| compact relative time | `core/src/library/format/` | delete the long form if nothing else uses it |
| status mark in rows | core `dom/list/` cell + `ui/icons/arcMark.ts` | dot for Unread; `MARK_TOKENS` tones |
| lastHighlight, note preview, file facts | `core/src/library-ui/derive/<subfolder>/` | derive/ holds 9 files already |
| paper file listing | port in core (`listDir` + stat), adapters in apps | name, kind, size, mtime, description |
| tree with papers | `core/src/library-ui/derive/<subfolder>/` | scopes + counts, folders then papers; lazy per folder |
| groups, paper unit, file tray, file actions | `core/src/library-ui/dom/list/<subfolder>/` | dom/list/ holds 7 files; `paperList.ts` stays ≤ 200 |
| header path scope rule, detail head | `dom/header/`, `dom/detail/head/` | Cite ⌄ reuses `flows/citeCopy.ts` |
| VS Code tree provider, REF iconPath, reveal queue, selection mark, Node listing adapter | `packages/vscode/src/ui/library/`, `libraryWebview/` | glue only |
| browser side bar, IndexedDB listing adapter | `packages/browser/src/library-page/` | consumes the core tree derivation |

**States** are A17–A20 (empty, loading, error, long text, narrow, themes) and A10–A11 (keyboard, screen reader). Loading uses placeholder rows; the file tray loads when a paper opens. Errors go through `ILogger`, then a toast or an inline tray row. Title and Status never hide.

## 6. Sessions

Sessions sharing a number form a wave and run at the same time, in the same worktree, by separate agents; the letter tells them apart. A session with no letter runs alone. A wave starts when every session of the previous wave is committed.

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1a | [sessions/1a-foundations.md](sessions/1a-foundations.md) | Lucide icons, tokens, compact time, row status mark; Q3 answered | yes |
| 1b | [sessions/1b-data.md](sessions/1b-data.md) | Data and protocol: stats, listing, description, reveal, selection, tree derivation; contracts | yes |
| 2a | [sessions/2a-core-list.md](sessions/2a-core-list.md) | Core list and detail head; old pieces deleted | yes |
| 2b | [sessions/2b-vscode.md](sessions/2b-vscode.md) | VS Code wiring: native tree, reveal both ways, Node listing | yes |
| 2c | [sessions/2c-browser.md](sessions/2c-browser.md) | Browser wiring: side bar on the core tree, IndexedDB listing | yes |
| 3 | done (log.md) | Harnesses, browser A14/A15, parity findings P1–P7 | no |
| 4 | done (log.md) | Tree bug diagnosed, browser Describe… round-trip | no |
| 5a | done (log.md) | Tree folder-key fix | no |
| 5c | done (log.md) | VS Code host A14, A15 tree→list, V2, R4 dark + HC | no |
| 5d | [sessions/5d-vscode-finish.md](sessions/5d-vscode-finish.md) | V4/V5 reveal findings, A15 list→tree, finish | no |
| 5b | done (log.md) | Browser A17–A19 pass; P8 found | no |
| 6 | done (log.md) | P1–P8, V3 and carried items decided; research for 7–9 | no |
| 7a | done (log.md) | `scope` message, filter bar and subfolder toggle removed; tree fix committed | yes |
| 7b | done (log.md) | P3, P4, P5, P8, menu Home/End, A18 VS Code log | yes |
| 8a | done (log.md) | One status mark (P6), "Folders" label (P7), VS Code tree dot | yes |
| 9 | [sessions/9-verify-close.md](sessions/9-verify-close.md) | Verify both hosts, A8/A18/A20/A21, plan closed | yes |

Rules for sessions of one wave:

- Each session file lists the paths it **owns**. A session edits only its own paths; a change it needs elsewhere is reported to the main thread, not made.
- Contracts and protocol types change only in 1b. Wave 2 implements them as written.
- Fields added to shared types are optional, so a sibling session's fixtures keep compiling.
- A gate failure in a sibling's owned files belongs to that sibling: report it, do not fix it.
- `commit-splitter` gets an explicit list of the session's own files.

Every session: `test-writer` writes failing tests at the public seam first (AGENTS.md §6); sessions with a UI result take light and dark screenshots with the `verify` skill, compared with `research/mockup/`; `finish`, then `commit-splitter` with explicit file lists only (other sessions and plans share the worktree).

Runner tiers: **H** session model (design, contracts), **M** Sonnet (specified implementation, tests), **L** Haiku (gates, commits).

## 7. Risks

- **R1** `paperList.ts` (152 lines) passes 200 with groups — groups and tray live in a `dom/list/` subfolder from the start.
- **R2** `tokenContrast` cannot check tinted backgrounds — file-type text tokens are opaque hex; tints are checked by eye in the screenshots.
- **R3** Thousands of paper nodes slow the native tree — children are computed per folder on expand; counts come from the derivation, not from walking nodes.
- **R4** REF and arc icons lose contrast in custom VS Code themes — light/dark variants from brand tokens; check high contrast in session 3.
- **R5** core-no-pills touches the same CSS — D6; whichever runs second re-greps `--ls-radius-pill` and `.ls-badge-`.

## 8. Log

See [log.md](log.md).
