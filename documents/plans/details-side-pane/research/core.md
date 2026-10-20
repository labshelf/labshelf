sha: 856ffa3
files: packages/core/src/library-ui/**, packages/core/src/writing/allProjects/**
source: Explore scout

# Core: detail panes today

Paths relative to `packages/core/src`. L = `library-ui`, AP = `writing/allProjects`.

## Frame
- `L/dom/shell/frame.ts` (79 lines): `buildFrame(host, prefs, {withSidebar, withCitationMap, detailLabel})` builds `div.ls-library` > [`aside.sidebar` + sash]? + `section.list-pane` + `div.sash.sash-detail` + `aside.detail-pane`. It returns `FrameSlots {root, sidebar, header, list, citationMap, detail}`. `PaneName = "sidebar"|"detail"` (not exported). `togglePane`/`showPane` are at :61-79. Callers: `L/dom/mountLibraryUi.ts:56`, `AP/dom/mountAllProjects.ts:98`.
- `L/dom/shell/sash.ts` (51): `attachSash`. Limits are in `L/dom/state/prefs.ts:42-52`: `PANE_LIMITS.detail {min 260, max 760, collapseAt 180}`, `DEFAULT_PREFS.detailWidth 360`, `detailCollapsed false`. Prefs also hold `detailTab`, `citeFormat` and `secCollapsed`. `PanePrefs` picks the detail and sidebar width and collapsed fields.
- Toggle buttons: `L/dom/header/listHeader.ts:25` (`data-act="detail"`, panel-right icon) with its handler at :47, and the AP header `onToggleDetail` (mountAllProjects.ts:113). `L/dom/menu/tagInputFocus.ts:8` calls `showPane(detail)`.
- CSS `L/dom/styles/library-ui.css:22-39`: `.sash-detail` and `.detail-pane` rules, all scoped under `.ls-library`. `library-detail.css` (100 lines) is also scoped under `.ls-library`. The global `html, body` and `#root` rules are at library-ui.css:19-21.

## Paper pane
- `L/dom/detail/detailPane.ts:158-182` `mountDetailPane(ctx, container)`. It renders from `ctx.store.get().selected`: 0 ids shows `PLACEHOLDER` (:16-19, with `kbd-help` hints for list keys), more than 1 shows `multiDetail.ts`, exactly 1 shows the single view. It subscribes to selected, papers, stats, details, similar, jobs, folder, pdfDirs and pdfBusy (:177).
- `L/dom/detail/paneState.ts:41-54` `paperView` resolves the paper from `s.papers`, so the store needs a `snapshot`.
- UiContext use inside detail: `store.get/select/selectOnly/openFolder/set`, `transport.post`, `prefs`, `caps`, `labels.revealPaper`, `readOnly`, `data.ensureDetails/ensureSimilar`, and `focusList()` (a no-op without `.paper-list`). `detailActions.ts:51` calls selectOnly and `:66` calls openFolder.
- `L/dom/uiContext.ts:59` `createUiContext`. `L/dom/hostMessages.ts` `attachHostMessages(ctx)` handles snapshot, details, similar, sidecarChanged, files, jobs, pdf.busy, notices and dialogs, plus the list-only navigate, reveal, select and citationMap.
- `L/dom/reportSelection.ts` posts `paper.selected {id|null}`, where null means none or several.
- `L/dom/mountLibraryUi.ts:46-74` composes the frame, ctx, host messages, header, list, citation map, `mountDetailPane(ctx, frame.detail)`, reportFolder and reportSelection, then posts `ready`.

## Project pane
- `AP/dom/detail/mountProjectDetail.ts:56-84` `mountProjectDetail(slot, {post, menu})` returns `{update(view)}`. It has no store. Its empty text is at :36.
- `AP/dom/detail/detailRequests.ts` `createDetailRequests(post)` caches results and posts `{type:"detail", id}`.
- `AP/dom/mountAllProjects.ts:95-140` keeps `s.selected` locally. `select(id)` calls `details.request(id)` and `render()` calls `pane.update(paneView(...))`. `routeMessages` handles `{files, detail, projects}`. `AllProjectsChannel {transport, prefs}` is at :28-30.
- Protocol: `AP/protocol/messages.ts` and `parseAllProjectsMessage.ts`. The host answers `detail` with `{type:"detail", id, detail}` or `{..., error}`. No contract doc exists for All projects.

## Protocol
- `L/protocol/messages.ts` (74), `messageGuards.ts` (87), `transport.ts` (16), `loopbackTransport.ts` (38).

## Counts
- L/dom/detail has 6 files plus head/ and tabs/. L/dom has 5. AP/dom/detail has 5.
- Line counts: detailPane 182, mountAllProjects 140.
