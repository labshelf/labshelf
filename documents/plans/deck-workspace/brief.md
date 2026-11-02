# Brief: one workspace for talks and posters

Written from the user's six mockups (TeX poster in Visual and Split, TeX slides in Visual and Split, HTML slides, HTML poster) and the conversation after them. The plan in this folder follows this brief.

## Goal

A talk or a poster, whether it is a LaTeX or Typst source or an HTML deck, opens in one workspace with the same structure. The header holds the mode tabs (Visual, Split, Code), the build state, the format and Export PDF. Below it are an insert toolbar, a structure panel on the left, the stage in the middle with a zoom bar, a properties panel on the right and a status bar. It replaces the article-like pairing of a text editor and a separate PDF preview for talk and poster sources. The HTML deck editor is reorganised into the same layout.

## What the mockups ask for

- **TeX poster, Visual.**
  - Structure panel: a Blocks list and an overview.
  - Insert toolbar: Text, Figure, Equation, Table, Columns, Theme and a size menu ("A1 · Landscape").
  - Selection: a block selected on the rendered poster gets a floating action bar.
  - Properties panel, with Content and Style tabs: title, figure with Replace, caption, width and column, alignment, "Block code", "Open in code" and "Selection synced".
  - Status bar: "Poster · A1 · 841 × 594 mm", plus a zoom bar.
- **TeX poster, Split.**
  - Code and preview side by side.
  - Breadcrumb "Poster > Column 3 > Results".
  - The block's code range highlighted.
  - Compiled state, select and hand tools, Guides, Sync selection, Reveal in preview.
- **TeX slides, Visual.**
  - Thumbnails with New slide, Layout and Theme menus, and a 16:9 picker.
  - A properties panel for the selected element and the speaker notes.
  - Status bar "Slide 4 of 8 · 16:9" with arrows, and Present.
- **TeX slides, Split.** The same as the poster, with a "Current slide" menu.
- **HTML slides.**
  - Slides and Elements tabs, undo and redo.
  - Insert toolbar: Text, Image, Equation, Chart, Shapes, Layout and Theme.
  - Text style panel: typeface, size, weight, colour, line height, alignment, X/Y/W/H, spacing and theme.
  - Preview, Present, Export, a code toggle and "All changes saved".
- **HTML poster.**
  - Structure and Elements tabs, a ruler in cm.
  - A chart panel: Data and Style tabs, Edit data, colours, legend and grid, position in cm, "Fit to column" and caption.

## What is possible, said to the user

- **Shared structure.** It works in every format. Most of the pieces already exist in core:
  - `decks/dom`: strip, theme panel, size picker, poster ruler;
  - `decks/sourceDeck*`: outline, insert, move, notes, size;
  - `reader/dom/previewDeck.ts`: thumbnails, notes, print check.
- **LaTeX Code and Split.** Fully possible. SyncTeX already links a source line to a PDF box and back in VS Code.
- **LaTeX Visual.**
  - Selecting a block works through SyncTeX: its boxes give the block's rectangle on the page.
  - The properties panel and the floating bar work for known patterns by rewriting the source:
    - tikzposter `\block` and `\column`;
    - beamer `frame`;
    - `\includegraphics[width=…]`, `\caption` and `\captionof`;
    - `itemize`, `equation`, `center` and `\centering`.
  - Every change recompiles, so the picture follows after the build, not while typing.
  - LaTeX can't place a block at a free pixel position by dragging. Visual mode reorders, resizes by width and column, and edits properties, but doesn't move blocks freely.
  - Hand-written LaTeX outside the known patterns gets only "Block code" and "Open in code".
- **Typst Visual.** It needs another way to find positions, because Typst has no SyncTeX. A spike decides how (see D7).
- **HTML.**
  - It is a reorganisation of the existing editor into the same shell, with new property panels.
  - Charts depend on the `feature/charts` work, which is not on main yet.

## Decisions taken in conversation

- The user saw the feasibility notes above and asked for the plan to be written. The two open questions were answered with my recommendations, recorded in plan.yaml as D1 and D2:
  1. A talk or poster source opens in the new workspace.
  2. The uncommitted toolbar and preview work is finished as session 0, because the workspace reuses it.
- Work on main, without delegating to other agents ("faça isso vc msm sem delegar a outros agentes … commite direto na main").
- Never stage `packages/core/src/writing/allProjects/dom/all-projects.css`, the user's own change, or `output/`.
- Everything committed is in English. The UI labels are the English forms of the mockup's Portuguese labels, as the rest of LabShelf is in English.

## Non-goals

- Dragging LaTeX or Typst blocks to free positions.
- Live preview while typing: the preview follows the build.
- A visual editor for arbitrary LaTeX outside the known patterns.
- PPTX.
- Animations.
