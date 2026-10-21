sha: 2953b2e
files: documents/ideas/spaces-mockup/**
source: Explore scout over the mockup, 2026-10-20

# What to reuse from the mockup

Mockup root: `documents/ideas/spaces-mockup/` (M). The JS is string-template HTML on globals, so no JS is copied as code. Port the CSS, the DOM structure and the pure logic, rebuilt with `el()` (`packages/core/src/ui/dom/dom.ts`), which also removes the mockup's unescaped fields (`glossary.js` `meaning()`, project fields in `overview.js`).

## CSS: port as is (token-clean)

Every colour, space, radius, font and shadow is a `var(--ls-*)` token that exists in `tokens.css`. The only literals are `1px` borders, media-query breakpoints, unitless line-heights, `fr` grids and `calc` multiples of tokens. Keep the class prefixes; turn id selectors into classes. Split long files to stay within the size limits.

| Mockup CSS | Target | Package |
|---|---|---|
| `markup.css` `.mk-status`, `.mk-ft`, `.mk-empty` | empty state and format tag widgets (drop `.caret`, `.tx-*` and the global `:focus-visible`) | 3.2 |
| `sidebar/sidebar.css` | Spaces section pane | 4.1 |
| `catalog/catalog.css` (without the avatar rules) | catalog | 4.3 |
| `space/space.css`, `space/overview.css` (`.sp-*`, `.ov-*`, `.tl-*`, `.act-*`) | frame, Overview | 4.4 |
| `space/papers.css` | Papers tab | 5.1 |
| `glossary/glossary.css` without `.gl-editor`, `.gl-ed-card`, `.gl-complete`, `.gl-pop` | Glossary | 5.2 |
| `notes/notes.css` (`.nt-row`, `.nt-split`), `discussions/discussions.css` (`.ds-*` layout), `discover/discover.css` | positioned tabs | 5.3 |
| `chat/chat.css` | chat panel | 5.4 |

## Structure: port the DOM, fix the ARIA

- `sidebar/spaces.js`: tree rows (`role=treeitem`, `aria-expanded`, `--depth`, `data-key`), only the twisty folds, the section heading with +, and the rows All Spaces / Space / folder / paper. Reuse the core `tree-*` classes. Folders there are flat; D3 needs `parent` nesting. → 4.1
- `catalog/catalog.js`: toolbar and row (title, purpose, count links, reading arc "done / total Done", up next, Personal). Keep the search input when the list re-renders. → 4.3
- `space/header.js`: `.sp-head` and the six inner tabs. The mockup uses `nav` + `aria-current`; the real one is a `tablist` with keyboard (A14). Share is positioned; members are "You". → 4.4
- `space/overview.js`: the `ovBlock(title, body, actions)` card and the `.ov-row` row (mark, name, sub, side) for projects and papers in focus. → 3.2 (card), 4.4
- `space/papers.js`: folder nav with counts and New folder, rows (status, title, authors · year, focus toggle with `aria-pressed`, remove). Replace the missing-PDF note with "Not in your Library" + Remove; drop "added by". → 5.1
- `glossary/glossary.js`: term row (notation column + body), conflict flag, the side column. → 5.2
- `chat/chat.js`: header, context, three suggestions, composer, privacy line. → 5.4
- `notes/notes.js`, `discussions/*.js`, `discover/discover.js`: layout reference only. Rewrite copy that sounds like a working feature as tooltip copy. → 5.3

## Logic: port as pure functions with tests (session 2 `view/`)

- `space/timeline.js:9-40`: sort by day, Today marker before the first date ≥ today, goal progress (read = Done / listed; project = checklist), overdue (past, task, not done), "in N days". Rework from day-of-month numbers and the fixed `TODAY` to ISO dates and a `today` parameter. → 2.1
- `catalog/catalog.js`: text filter on name + purpose, All / Personal / Shared; up next = first undone task, else first deadline, on sorted dates. → 2.1
- Not in the mockup, write new: glossary symbol conflicts (group by normalised symbol, groups > 1), tree from `parent`, `.ics`.

## Icons

`markup.js` aliases map mockup names to stand-ins (space→layers, share→link, deadline/goal→target, item→check, bell→info, eye/compass→search, version→git-compare, ban→warning, run→arrow-right). Use real core names directly, with no alias layer; `share`, `calendar` and `users` are added in 3.3.

## Fixtures

`data/spaces.js` and `data/library.js` (three Spaces, mixed dates, checklist counts) make good test fixtures for 2.1 once mapped to the contract: day strings → ISO, `item`/`goal` → `task`/`read`/`project`, drop `by`.

## Discard

`core.ts`, `actions.js`, `app.js`, `index.html`, `editor/*`, `sidebar/library.js`, `notes/noteBody.js`, `notes/paperPage.js`, `glossary/glossaryPreviews.js`, `identity/*`, `insert/*`, `build.mjs`.
