# Session 2a — Core list and detail head

- **Wave:** 2, runs at the same time as [2b-vscode.md](2b-vscode.md) and [2c-browser.md](2c-browser.md)
- **Starts from:** 1a and 1b committed
- **Ends with:** A1, A4–A13, A17–A19 in the core webview; unused pieces deleted
- **Commit:** yes, at the end of the session, owned files only
- **Research:** components.md, mockup.md

## Owns
`core/src/library-ui/dom/` (list, header, detail, styles) and its mirrors under `core/__tests__/`; Feather-only glyphs and CSS rules this session makes unused.
**Do not touch:** `packages/vscode/`, `packages/browser/`, the protocol, `derive/`, `documents/contracts/`. If the list needs a protocol change, stop and report it; it goes back to the main thread.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2a.1 | Columns, zebra, selection band, `:focus-visible`, treegrid roles, header path scope rule | — | H · ui-design, then M · test-writer, implementer | A1, A4, A9–A11 | [ ] |
| 2a.2 | Folder groups, paper unit, file tray, facts, file actions, Describe… | 2a.1 | M · test-writer, then implementer | A5–A8 | [ ] |
| 2a.3 | Detail head: venue › folder, Open PDF soft, Cite ⌄, ⋯, status ⌄, #tags + | — | M · test-writer, then implementer | A12, A13 | [ ] |
| 2a.4 | States: empty, loading, error, long text, narrow | 2a.1–2a.3 | M · implementer | A17–A19 | [ ] |
| 2a.5 | Verify, finish, commit | 2a.1–2a.4 | `verify` headless light + dark vs `research/mockup/`, `finish`, `commit-splitter` | gate passes | [ ] |

## Shared context
- Group, unit and tray code go in a `dom/list/` subfolder (7 files there); `paperList.ts` stays ≤ 200 lines; rowReconciler keeps the paper unit as one node.
- Keep the left twistie, dividers and column headers (memory `library-list-redesign-feedback`). Group labels have no twistie (Q2).
- Status mark and status ⌄ supersede the list/detail pills of core-no-pills (D6). If core-no-pills runs in this wave, re-grep `--ls-radius-pill` and `.ls-badge-` before committing (R5).

## 2a.1 — Grid
- **Do:** COLUMNS = Title, Authors, Year, Last read, Status; drop Publication and in-title chips; `aria-sort`; roving tabindex; Arrow keys enter the tray; breadcrumb hidden for All papers and status scopes.
- **Test first:** heads and sort, keyboard path into file rows, roles and aria states.

## 2a.2 — Groups and tray
- **Do:** own papers first, unlabelled; subfolder groups with "X › Y › Z" label, count, collapse first … last two, sticky; tray from the 1b.3 listing with type in mono colour, one fact, tooltip size + modified; hover/focus actions open to the side, reveal, copy path (labelled); Describe… in the row menu opens quick input.
- **Test first:** group order and labels, tray content, action messages.

## 2a.3 — Detail head
- **Do:** venue ending "› folder"; Open PDF uses soft-button tokens; Cite ⌄ via `flows/citeCopy.ts`; remaining toolbar actions move into ⋯; status ⌄; #tags mono with + inline input. Keep every tab field.
- **Test first:** head structure and menus in `detailPane` tests.

## 2a.4 — States, then delete
- **Do:** messages for empty library, folder, search; loading rows; error toast/row; narrow width hides Last read, Authors, Year in that order. Delete Publication column code, `loc-chip`, list pill badge, old toolbar buttons, Feather-only glyphs and CSS rules made unused. Grep `packages/vscode` and `packages/browser` too; a use found there is reported to 2b or 2c, not deleted here.
