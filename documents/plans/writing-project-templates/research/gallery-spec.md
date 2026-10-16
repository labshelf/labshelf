sha: fc9a469
files: packages/core/src/writing/templates/protocol/**, the planned packages/core/src/writing/templates/dom/**, the S3.3 VS Code panel; covers research/mockup/Main.dc.html and Detail.dc.html (not Publish)
source: S3.1 ui-design, 2026-10-16

# Template gallery: component spec and protocol

Brief S3.2 and S3.3 from this file; the mockup is not needed. Gaps 1–7 of [gallery-ui.md](gallery-ui.md) are applied: thumbnails as `data:` URIs, `fromCache` per source, host-computed `engineProblem`, optional `files`, no Compile here / Open sample PDF / Publish buttons, no Downloaded mark, no pill shapes.

## Protocol (`core/src/writing/templates/protocol/`, exported from `@labshelf/core`)

```ts
type TemplateKey = { source: TemplateSourceId; id: string };
type SourceListing = { status: "loading" } | { status: "ready"; entries: TemplateEntry[]; fromCache: boolean } | { status: "error"; message: string };
GalleryToHost = ready | refresh | { thumbnails; templates: TemplateKey[] } | { detail; template } | { use; template }
HostToGallery = { source; source; listing } | { thumbnail; template; dataUri? } | { engine; template; problem? }
              | { "use.settled"; template } | { notice; kind: "info" | "error"; text }
```

`parseGalleryMessage(raw)` validates every UI message (known type, source in `TEMPLATE_SOURCES`, id 1–128 chars, at most 200 keys per `thumbnails`). Transport types `GalleryTransport` / `GalleryHostEnd` reuse library-ui's `MessageEnd`. Filtering never crosses the channel: the page runs `filterTemplates`.

## Mount API

`mountTemplateGallery(root: HTMLElement, transport: GalleryTransport): { dispose(): void }` — builds the frame in `root`, subscribes, posts `ready`. `dispose` unsubscribes, disconnects the observer and empties `root`.

| Interaction | Sends |
|---|---|
| mount | `ready` |
| Refresh button in the sidebar header | `refresh` (every source row turns to loading) |
| cards enter the viewport (IntersectionObserver, `rootMargin` one card row); each key at most once per listing | `thumbnails` with the keys not yet requested |
| open a card | `detail` (host answers `engine`); plus `thumbnails` for it if not yet requested |
| Use template | `use`; the button stays busy until `use.settled` for that key |

Host messages: `source` replaces that source's listing (a new listing clears the thumbnails requested for it); `thumbnail` fills every card and the detail preview of that key; `engine` fills the detail warning when it is the open key; `notice` shows a core toast (`ui/dom/widgets/toast.ts`).

## Layout and tokens

Frame: CSS grid, sidebar column then main. Background `--ls-bg`, text `--ls-fg`, font `--ls-font` at `--ls-font-size`. Under the narrow breakpoint (container query on `.ls-tpl`) the sidebar stacks above the main column. Two layout widths have no token yet: S3.2 adds `--ls-gallery-sidebar-w` and `--ls-gallery-card-w` (minimum card width) to the token data and regenerates `tokens.css`; no px literal in the CSS.

Focus everywhere: core `:focus-visible` outline `--ls-focus`. All text truncates with ellipsis and carries the full text in `title`.

### Sources sidebar — `nav.ls-tpl-sidebar[aria-label="Template filters"]`
- Background `--ls-sidebar-bg`, right border `--ls-sidebar-border`, padding `--ls-space-4` 0.
- Section header `div.ls-tpl-section` per group ("Sources", "Format"): `--ls-text-sm`, uppercase, `--ls-section-fg`, padding `--ls-space-4` `--ls-space-7`. The Sources header ends with `button.ls-icon-btn` icon `refresh`, `aria-label="Refresh templates"`.
- Source list `ul.ls-tpl-sources[role=listbox][aria-label="Sources"]`, rows `li.ls-tpl-source[role=option][aria-selected]`: "All sources", "LabShelf Community", "Typst Universe", "My templates". Height `--ls-row-h`, padding 0 `--ls-space-7`, hover `--ls-list-hover`, selected `--ls-list-active-bg` / `--ls-list-active-fg`. No coloured dots. Roving tabindex: one row in the Tab order; Up/Down/Home/End move and select; selection sets `filter.source` ("All sources" = undefined).
- Row tail `span.ls-tpl-source-note`, `--ls-text-sm`, `--ls-desc`: count of entries when ready; "cached" appended when `fromCache` (title "Listed from this device; refreshes when online."); icon `loader` (spinning, `aria-label="Loading"`) while loading.
- Error: under the row, `div.ls-tpl-source-error[role=status]`, icon `warning`, colour `--ls-error`, `--ls-text-sm`, the host's message. Other sources still list.
- Format group: two `label.ls-checkbox` rows, "LaTeX" and "Typst", both checked at start. Checked set → `filter.formats`; both or neither checked means every format.

### Facet bar — `div.ls-tpl-facets` at the top of main
- Padding `--ls-space-7`, gap `--ls-space-4`. Row 1: `h1.ls-tpl-title` "Templates" (`--ls-text-lg`, weight 600) and core `.ls-search` (icon `search`, input `type=search`, `aria-label="Search templates"`, placeholder "Search templates, classes, authors", clear button per `.ls-search-clear`). Input sets `filter.query` on each input event (filtering is in memory). Escape in the input clears it.
- Row 2: `div.ls-tpl-categories[role=group][aria-label="Category"]` of `button.ls-tpl-category[aria-pressed]`: All, Article, Thesis, Poster, Slides, CV, Other. Shape: `--ls-radius-sm`, height `--ls-row-h`, padding 0 `--ls-space-5`, border `--ls-border`, `--ls-text-md`, transparent. Pressed: background `--ls-list-active-bg`, colour `--ls-list-active-fg`, border `--ls-focus`. Exactly one pressed; "All" = undefined. Left/Right move focus within the group.

### Card grid — `ul.ls-tpl-grid[aria-label="Templates"]`
- CSS grid `repeat(auto-fill, minmax(var(--ls-gallery-card-w), 1fr))`, gap `--ls-space-7`, padding 0 `--ls-space-7` `--ls-space-7`. Order: entries of Community, then Universe, then Mine, each in source order, through `filterTemplates`.
- Arrow keys move focus between cards (columns read from layout), Home/End to first/last; Tab leaves the grid.
- While every source is loading and no entries exist: three skeleton cards `li.ls-tpl-card.is-loading[aria-hidden]` with thumbnail and lines in `--ls-section-bg`.
- Empty state (no entry after filtering, at least one source ready): core `.ls-empty` with `.ls-empty-icon` icon `grid`, `.ls-empty-text` "No templates match these filters.", `.ls-empty-hint` "Clear the search or pick another category."; when every source failed: text "Templates could not be listed.", hint "Check the connection, then refresh."

### Card — `li > button.ls-tpl-card`
- `aria-label` = template name; Enter/Space/click open the detail page. Background `--ls-widget-bg`, border `--ls-border`, `--ls-radius`, overflow hidden; hover border `--ls-focus`.
- `div.ls-tpl-thumb`: aspect ratio of an A4 page, background `--ls-section-bg`, bottom border `--ls-border-soft`. With a thumbnail: `img` (`alt=""`, `object-fit: cover`, top aligned, `loading=lazy`). Without: centred icon `file-text` at the empty-icon opacity, `--ls-desc`.
- `div.ls-tpl-card-body`, padding `--ls-space-5`, gap `--ls-space-2`: `.ls-tpl-card-name` (`--ls-font-size`, weight 600, one line); `.ls-tpl-card-by` (`--ls-text-sm`, `--ls-desc`, one line): "<authors joined by ', '> · <source label>"; `.ls-tpl-card-meta` (`--ls-text-sm`, `--ls-desc`): format label, engine label, category label joined by " · ". No badges, no Downloaded mark.

### Detail page — `section.ls-tpl-detail[aria-labelledby=<h1 id>]`, replaces the facet bar and grid inside main; the sidebar stays
- Header `div.ls-tpl-detail-nav`: `button.ls-btn` icon `arrow-left` + "Templates". Click or Escape anywhere in the page returns to the grid with the filters kept and focus on the card that was opened. On open, focus goes to the h1 (`tabindex=-1`).
- Two columns (stacked when narrow), gap `--ls-space-7`, padding `--ls-space-7`:
  - `figure.ls-tpl-preview`: background `--ls-section-bg`, border `--ls-border`, `--ls-radius`, padding `--ls-space-7`; `img` with `alt="First page of the <name> template"` and shadow `--ls-page-shadow`, or the card placeholder at preview size.
  - `div.ls-tpl-info`, gap `--ls-space-6`: `h1` name (`--ls-text-lg` × weight 600); by-line as on the card; `p.ls-tpl-description` (`--ls-font-size`, `--ls-fg`, preserved line breaks); `button.ls-btn.ls-btn-primary.ls-btn-lg` "Use template" (busy: `disabled`, `aria-busy=true`, icon `loader`, label "Creating project…"); engine warning; metadata; files.
- Engine warning: `div.ls-tpl-engine[role=note]`, icon `warning` in `--ls-warning`, background `--ls-warning-bg`, border `--ls-warning-border`, `--ls-radius`, padding `--ls-space-4` `--ls-space-5`, `--ls-text-md`; text = the host's `problem`. Hidden until an `engine` reply with a problem arrives for the open key.
- Metadata `dl.ls-tpl-meta`: grid of `dt` (`--ls-desc`, `--ls-text-md`) / `dd` (`--ls-fg`): Format, Engine, Category, License, then Version (when `version`), Needs Typst (when `compiler`, "<compiler> or later"). Row gap `--ls-space-3`.
- Files, only when `entry.files` exists: section header "Files" as in the sidebar, then `ul.ls-tpl-files`, each `li` with icon `file` (or `folder` for a path ending in "/") and the path in `--ls-mono` at `--ls-text-md`; `entry.main` first, then sorted.

### Labels (runtime-neutral, so the terminal can reuse them)
`core/src/writing/templates/templateLabels.ts`: source → "LabShelf Community" / "Typst Universe" / "My templates"; format → "LaTeX" / "Typst"; engine → "pdfLaTeX" / "LuaLaTeX" / "XeLaTeX" / "Tectonic" / "Typst" (match `TEMPLATE_ENGINES`); category → "Article" / "Thesis" / "Poster" / "Slides" / "CV" / "Other".

## File layout — `core/src/writing/templates/dom/` (7 files + index, each ≤ 200 lines)

| File | One responsibility |
|---|---|
| `index.ts` | exports `mountTemplateGallery` |
| `mountTemplateGallery.ts` | builds the frame, routes host messages to the state and views, posts `ready` |
| `galleryState.ts` | holds listings, filter, requested thumbnails, thumbnail URIs, busy keys and the open key; derives the visible entries |
| `sourcesSidebar.ts` | renders source rows, their notes and errors, the refresh button and the format checkboxes |
| `facetBar.ts` | renders the title, search and category toggle buttons |
| `cardGrid.ts` | renders cards, skeletons and the empty state, grid keyboard moves, and requests thumbnails as cards come into view |
| `templateCard.ts` | renders one card with its thumbnail or placeholder |
| `templateDetail.ts` | renders the detail page and its engine warning, metadata and files |

CSS: `core/src/writing/templates/dom/styles/template-gallery.css`, exported in `core/package.json` as `"./styles/template-gallery.css"`. Classes prefixed `ls-tpl-`. DOM tests under `core/__tests__/writing/templates/dom/` (jsdom; stub `IntersectionObserver`, which jsdom lacks).

## VS Code host (S3.3)

Panel per `vscode/src/ui/list/listWebviewPanel.ts` (singleton, `retainContextWhenHidden`, CSP with nonce and `img-src ${cspSource} data:`), bundle entry importing `tokens.css`, `vscodeHost.css`, `base.css`, `toast.css`, `template-gallery.css`. Every incoming message goes through `parseGalleryMessage`; a rejected one is logged and dropped.

| Receives | Does | Sends |
|---|---|---|
| `ready`, `refresh` | for each source in parallel: abort its previous `list()`, post loading, await `list()` | `source` loading, then ready (`entries`, `fromCache`) or error (message logged with source id) |
| `thumbnails` | per key: find the entry in the last listing (unknown key: log, skip), `source.thumbnail(entry, signal)`, base64 with the MIME by magic bytes (png / webp) | `thumbnail` per key, `dataUri` absent on miss or failure (failure logged) |
| `detail` | probe engines once per panel (typst bundled; tectonic when its asset exists; pdflatex/lualatex/xelatex need `latexmk` and the engine on PATH), then core `engineProblem(entry, availability)` | `engine` with `problem` or without |
| `use` | ask the project title (quick input), `source.files(entry)`, `createProjectFromTemplate`, open `main` | `use.settled` always (cancel, success, failure); on failure also `notice` error with the source's message |

Dispose aborts in-flight `list`/`thumbnail` calls.
