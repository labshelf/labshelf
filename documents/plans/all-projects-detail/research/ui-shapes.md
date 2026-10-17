sha: 18723264 (plus uncommitted work)
files: packages/core/src/writing/allProjects/dom/**, packages/core/src/library-ui/dom/**
source: planning thread, 2026-10-17 (decided UI, from the user's mockup)

# Decided UI

All colours, fonts, sizes from core tokens; icons from `icon()`; Library classes reused. Soft and flat: hairlines, ghost buttons, one primary action.

## List (session 2)

- Heads: twistie | Title | Engine | Cites | Build | Modified | actions. Title, Cites, Modified sortable; Engine and Build are short, centred, not sortable. Modified/"Trashed" in trash.
- Title cell: highlighted title, external icon, then, when `row.target?.venue` exists, a mono chip `<venue> · <n> d` (days from today to `deadline`, local calendar days); within 14 days it uses the warning token; past the deadline it reads `<venue> · passed`, muted; venue without deadline shows the venue alone.
- Engine: `formatLabel(row.format)` (TEX/TYP), moved out of the Title cell; broken rows keep their warning there.
- Cites: `row.cites`, then `row.unresolvedCites` in the error token when > 0 ("30 2"); tooltip "30 cited, 2 not found". Blank when undefined.
- Build: a dot `span.ls-build-dot.b-<state>`: ok success token, warnings warning token, failed error token, building pulsing muted, earlier muted filled, never hollow (border only). Tooltip: "Built 2 h ago, 2 warnings" / "Built in an earlier session" / "Never built".
- Modified: `compactTime(row.modified)` ("2 h"), full date in the tooltip.

## Tray (session 2)

- Each `TrayEntry` uses `fact.label` as the role: Main (`row.main`), Bibliography (`detail.bibliography.file`), Contents (a folder holding a path in `detail.sources`), Last build (the log row).
- Facts: Main "8 pages · 2 warnings · <first.message> in <file>:<line>" (parts present only); Bibliography "12 entries written from the library · synced 2 h ago" (`generated`), else "12 entries"; folder "Contents: intro, related, method, …" (child base names, at most 4, then "…"); log "2 warnings, 0 errors, 8 pages".
- Log row: type LOG, name `detail.log`, shown for LaTeX when `detail.log` exists; opening it posts `openLog`.
- Last row "+ Add file": opens core quick input ("File path in the project, e.g. sections/related.tex"), posts `createFile`.
- Facts need the detail: expanding selects, the page requests `detail{id}` for the selected project on select and on every `projects` message, and keeps the last detail per id (`dom/detail/detailRequests.ts`).

## Pane (session 4)

- Frame: `buildFrame(host, prefs, { withSidebar: false, withCitationMap: false, detailLabel: "Project details" })`; panel-right `ls-icon-btn` in the header calls `togglePane(root, prefs, "detail")`.
- Head (`.detail-head`): `.head-more` opening the row menu entries; mono `.detail-title`; `.detail-meta` "LaTeX · main.tex · 8 pages · modified 2 h ago"; `.detail-toolbar` primary `.ls-btn.ls-button-soft.open-btn` labelled `openLabel`, ghost "Preview"; `.detail-status-row`: build dot + "2 warnings" / "Built" / "Build failed" / "Never built", then, with a venue, a target icon from the icon set and "ICLR 2027 · 41 d".
- Tabs via the generic `tabBarHtml`: Overview | Citations <n> | Versions <n>.
- Overview sections (`section()` + `kv()`): Target & limits (Venue "ICLR 2027 · due in 41 days" with an edit `iconBtn`; Pages "8 / 9"; Words "5,120"; a bar `.ls-limit-bar` for pages counted/limit, warning token at the limit, error token past it; sentence "1 page left · counted up to the references" or "· counted to the end"); Build (Engine, Main, Last build dot + time + first message; buttons "Build now", "Open log" when `detail.log`); Bibliography <entries> (the tray sentence); Location (collapsed by default: folder path, sidebar folder, "Outside the library" when external).
- Citations: rows key (mono) · title · authors · year; `source: "none"` rows lead with the error token "Not found"; `bib` rows say "from <file>".
- Versions: rows name · `compactTime(created)`.
- Venue edit: quick input for the venue (empty clears), then the deadline `YYYY-MM-DD` (validated, empty clears), then post `setTarget`.
- No selection: muted "Select a project to see its details."; a detail error shows its message, muted.
