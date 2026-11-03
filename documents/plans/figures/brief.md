# Brief: one Figure block and the figure workspace

Branch `feature/figure-workspace`, worktree `.claude/worktrees/figures`. Asked by the user on 2026-11-02 with three mockups
(drawing, function explorer, data chart). The user waives the test and lint gates for this work; the rules against duplicated
code, oversized files and functions, and comment noise still hold. UI text is English (the mockups are Portuguese).

## Decisions

- D1. One block, `labshelf-figure`, replaces `labshelf-drawing` and `labshelf-chart`; nothing else writes them. Readers still
  read the two old divs and turn them into figures, so existing notes keep their content; the next write uses the new block.
- D2. One model, `FigureModel` (`packages/core/src/qmd/chart/model.ts`, renamed in place): `{v: 1, id, kind, title?, …}` with
  `kind` `drawing` (the drawing model's `points` and `items`), `plot` (functions, variables and panels) or `data` (table,
  traces, layout). `fn2d` and `fn3d` merge into `plot`: a plot has `panels: [{dims: 2 | 3, layout}]` and each function names
  its `panel`.
- D3. Paper output: a drawing writes its TikZ guard and SVG; a plot or data figure writes the pgfplots guard when pgfplots can
  draw it, else only the PNG. One guard shape for both (`tikzpicture` / `pgfplotsset`).
- D4. One editor, the figure workspace (`packages/core/src/qmd/dom/figureEditor/`), fullscreen over the note: header (back,
  breadcrumb, save state, Code, Insert figure / Done), left panel, toolbar, stage, inspector with tabs, status bar. Its chrome is
  the shared workspace shell in `packages/core/src/ui/dom/workspace/`.
- D5. A new figure opens on a three-mode chooser (Drawing, Functions, Data); the mode's starters follow (a function, a table).
- D6. Modes follow the mockups:
  - Drawing: tools grid (Select, Point, Segment, Arrow, Circle, Rectangle, Function, Label), Objects list with visibility,
    undo/redo, Snap, Grid, Guides, units, rulers, a floating selection bar (colour, line style, width, duplicate, more), and an
    inspector (Properties / Style: expression with rendered TeX and validity, domain, label with position, stroke colour,
    width and style, axes and scale). Status: size in cm, hints, TikZ output, errors.
  - Functions: function list (visibility, colour, rendered TeX, panel), + Expression / + Parameter, parameters with slider and
    play, Overlay in one panel / New panel; toolbar (select, pan, + Panel, Axes, Grid, Fit); panels side by side or stacked,
    each with its header, legend, coordinates, zoom and home, 3D with perspective; header 2D / 3D / Both; inspector
    (Function / Appearance: expression, domain, panel, move to new panel, rendering, colour, opacity, resolution, axes and
    camera).
  - Data: data source card (import CSV, paste table, linked file, refresh), series list, + Add series, New panel, row filter and
    computed column; toolbar (select, pan, chart type, Axes, Legend, Fit); chart over a table panel (Table / Import tabs, + Row,
    column role badges X, Y1, ±Y1); inspector (Mapping / Style: source, X and Y columns with units, Y errors, legend, display
    points / lines / both, axes and scale, export); status (rows, series, panels; selection synced with the table).

## Phases

1. Model and block merge (D1–D3), the note node, outline, insert menu and source editor.
2. Workspace shell (D4) and the mode chooser (D5).
3. Data mode, then Functions mode, then Drawing mode (D6).
4. Contract `documents/contracts/qmd-items.md` (one Figures section), docs, removal of what the merge leaves unused.
