sha: 28100aa
files: documents/ideas/spaces-mockup/**, packages/core/src/ui/dom/widgets/**
source: design pass 3.1, 2026-10-21

# Spaces UI design

Layout follows the mockup. Widgets live in `core/src/ui/dom/widgets/` with `ls-` classes and take over the mockup rule named below; surfaces keep the mockup prefixes (`sp-`, `ov-`, `tl-`, `pp-`, `gl-`, `catalog-`, …).

## Widgets (3.2)

- **pageTabs** (from `.sp-tabs`): `role=tablist` of `role=tab` buttons, `aria-selected`, roving `tabindex`, `aria-controls` the panel, which gets `role=tabpanel` and `aria-labelledby`. Left/Right/Home/End move focus, Enter/Space select (manual activation, like the Details strip). `details/dom/tabStrip.ts` shares the arrow-key function: two looks, one keyboard model.
- **segmentedFilter** (from `.dc-chip`, `.dc-n`): `role=group`, `aria-pressed` buttons, optional count; a click reports the id.
- **progressMark**: `done / total` → `arcMarkElement` (none at 0, ok+full at total, accent+half between), label "3 of 5 Done".
- **sectionCard** (from `.ov-block`, `.ov-head`): `section` labelled by its `h2`, actions slot, body.
- **emptyState** (from `.mk-empty`, onto the existing `.ls-empty` classes): text, hint, icon, action; `inline` variant for cards. `library-ui/dom/list/emptyState.ts` keeps its paper copy and builds on this widget.
- **memberChip**: initials, `role=img`, name in `aria-label` and `title`; only "You" here.
- **positioned**: a planned control: `aria-disabled=true`, `title` naming what is missing, `ls-positioned` look, click and Enter swallowed. No native `disabled`: the control stays focusable so keyboard and screen-reader users reach the reason.

Icons (3.3): `share`, `calendar`, `users`, Feather style.

## Surfaces

- **Sidebar section** (4.1): core `tree-*` rows, `role=tree`/`treeitem`, `aria-expanded` on folding rows. Rows: All Spaces, Space (`layers`), folder, paper with `statusMark`.
- **Catalog** (4.3): header "All Spaces" with New Space (primary). Toolbar: search input and segmentedFilter All / Personal / Shared. Row: title, purpose, count links, progressMark, up next, Personal/Shared. Empty: "No matching Spaces." / "Try another name or filter."
- **Frame** (4.4): `.sp-head` name, purpose (or "Add a purpose"), memberChip "You", Share positioned ("Sharing needs a signed-in account"). pageTabs Overview, Papers, Notes, Discussions, Discover, Glossary.
- **Overview** (4.4): two columns of sectionCards.
  - Dates and goals: `ol.tl-list`, Today marker `li`; goals carry a progressMark; overdue shows the word "Overdue" in the err tone. Empty: "No dates yet." / "Add a task, a reading goal or a deadline, and the timeline appears."
  - Projects: `.ov-row`, Link action. Empty: "No linked projects." / "Link a project to see its deadline and checklist here."
  - Papers in focus: `.ov-row` with `statusMark`. Empty: "No papers in focus." / "Mark the papers you are working on in Papers, and they stay here."
  - Members: memberChip rows. Hint: "Only you." / "Share the Space to work on it with others."
  - Discussions: positioned card. Empty: "No open topics."
  - Since your last visit: "Nothing new since your last visit." / "When others share this Space, what they add, edit and tick shows here."
- **Papers** (5.1): `.pp-*`; folder nav with counts and New folder (`inputBox`); rows: status button, title, authors · year, focus toggle (`aria-pressed`), remove (`confirmDialog`). Missing paper: "Not in your Library" + Remove.
- **Glossary** (5.2): `.gl-*` term rows, conflict flag (`warning` icon + text). Empty: "No terms yet." / "Select a term in a paper to add it."
- **Notes, Discussions, Discover** (5.3): mockup layout, every control positioned. Mockup empty copy, phrased as what the tab will do.
- **Chat** (5.4): `.chat-*` panel; composer and suggestions positioned ("Needs a connected model"); messages `aria-live=polite`.

States: long titles ellipsize with `title`; narrow widths wrap the header; focus uses `--ls-focus`; light and dark from tokens.
