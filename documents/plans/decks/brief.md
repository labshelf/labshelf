# Brief: talks and posters (decks) in writing projects

Decisions taken with the user in conversation. The plan in this folder is written from this brief. The user pre-approved the plan and its unattended execution; they are away and answer no questions. Where this brief is silent, pick the option that keeps current behaviour and record it as a decision.

## Goal

A writing project (LaTeX or Typst) gets talks and posters. An external Claude creates them as HTML through LabShelf's MCP server, following editability rules the server hands out; the server validates every write deterministically and answers with precise diagnostics. The user edits them in a LabShelf deck editor that is intuitive, clean and fluid (VS Code and browser), presents talks with a presenter view, previews posters at real size with a calibrated ruler, exports PDF and single-file HTML, and shares them through an encrypted LabShelf link with a QR code.

## Decisions

- **D1 Format: HTML with an editability vocabulary, aesthetics free.** A deck is HTML in the project folder (suggested `talks/<name>/deck.html` with its theme CSS and assets beside it). Rules exist only so the editor can edit: one element per slide (a poster is one slide), blocks marked with a stable id attribute and a position/size the editor can read and write, theme values as CSS custom properties in a separate theme file, text edited only in leaf text elements, math kept as TeX source and rendered with the MathJax the core already bundles (`mathjax-full`), assets as project-relative paths inside the deck folder. Inside a block the CSS and HTML are free: two decks can look completely different. Exact attribute names, units and the theme file name are decided in the contract package.
- **D2 Sizes: presets plus custom.** Talks: 16:9 1920×1080, 4:3, 16:10 presets and any custom pixel size. Posters: A0, A1, A2, ARCH E, 36×48 in, 48×36 in presets, portrait or landscape, and any custom size in mm or inches. No fixed single size.
- **D3 Deterministic validation.** One pure validator in core, used by the MCP server on every write and by the editor on open. Same input, same diagnostics: each with a stable code, a severity (error blocks the write; warning does not), a location (slide index, block id, line) and a one-line fix hint. Performance-heavy CSS (backdrop-filter, large animated filters) is a warning, not an error. A deck edited by hand is validated the same way on open; an invalid deck still opens read-only with its diagnostics.
- **D4 Optional link to the paper.** A block may reference a paper element (figure file, equation label, table, citation key); when the referenced source changes, the block shows as out of date, like figure recipes and note origins do today. Citations resolve from the library.
- **D5 MCP.** `labshelf mcp` (terminal composition root, see documents/plans/ai-mcp/plan.md D2/D6) gains deck tools: get the rules (the editability vocabulary with a short example), read bounded project context needed to make slides (the manuscript outline and sections, figure files, bibliography entries), create/replace a deck, apply an edit to a deck, validate a deck. Writes are restricted to the project's deck folders and resolved paths; every write is validated and rejected with diagnostics on errors. If no MCP server exists yet, this plan adds the minimum server needed for these tools only; library read tools stay with the ai-mcp plan.
- **D6 Editor.** Direct manipulation: click text to edit in place (leaf elements only), drag and resize blocks with snapping to a grid and alignment guides, slide strip to reorder, add, duplicate and delete slides, a theme panel editing the theme custom properties, a size picker with the D2 presets, undo/redo, a source view of the HTML kept in sync. Deck content renders isolated (sandboxed iframe with its own CSP) so free CSS never leaks into the app UI; follow documents/ui.md for the app chrome. During a drag only a transform changes; the HTML is written on release. Performance rules: one live iframe for the slide being edited, cached raster thumbnails for the strip, downscaled image proxies while editing and originals on export.
- **D7 Talks: presenter mode.** Full-screen presentation from the HTML (not a PDF), presenter view with notes, timer, current and next slide; keyboard navigation. Speaker notes live in the deck HTML in an element the vocabulary defines.
- **D8 Posters: real-size preview.** A large canvas with zoom and pan and a calibrated ruler in physical units. Calibration: the user matches an on-screen line to a physical object of known size (e.g. a card of 85.6 mm) once per device; stored device-local, never synced. Warnings for text smaller than a physical threshold at print size (e.g. under 24 pt on A0, scaled by size). No distance simulator (the user rejected it).
- **D9 Export.** PDF through a Chromium engine, in this order: a system Chromium (Chrome, Edge, Brave, Chromium) found on the machine, run headless with print-to-PDF; a managed `chrome-headless-shell` downloaded on demand, following documents/contracts/managed-tools.md; in the browser extension, through LabShelf Helper when installed. When none is available, the deck opens in the user's default browser (e.g. Firefox) for Print → Save as PDF, with a message saying that installing Chromium (or the Helper, in the browser) makes the PDF save automatically. A Firefox-only browser extension without the Helper always uses the print dialog. Page size comes from the deck's size (CSS `@page`). PDF output is RGB. Also export a single self-contained HTML file (images, fonts, theme and math inlined) that opens offline in any browser.
- **D10 Share.** An encrypted share link carries the deck, reusing documents/contracts/share-link.md and the owner's relay Worker; a viewer page presents the deck in the browser. The link, the encryption and the manifest of that contract are frozen: a deck share needs a new manifest kind or version, or its own path, decided in its contract package without breaking existing links. A QR code of the link can be generated and inserted into a poster or slide as an image block.
- **D11 Size budget.** The editor adds at most about 1 MB to each extension. No bundled Chromium; no bundled theme fonts (a deck's fonts live in its folder).

## Scope

Core (format, validator, deck model and edit operations, editor DOM, presenter, poster preview, single-file HTML, share manifest), terminal (MCP server and deck tools, PDF export engine discovery), VS Code (custom editor for decks, commands to create a talk or poster, export), browser (deck editor and presentation where the browser can reach project files; Helper export; print fallback), the share viewer, documents (contracts, product.md, ui.md).

## Acceptance

- A1 The validator returns the same diagnostics for the same input, with code, severity, location and hint; an error-free sample deck of each kind (talk, poster) passes; each rule has a failing sample.
- A2 Through MCP, a client gets the rules, creates a deck in a project, and a write that breaks a rule is rejected with the diagnostics; a write outside the project's deck folders is refused.
- A3 Edit operations (move, resize, edit text, reorder/add/delete slides, theme change, size change) round-trip: applying them to a deck and serialising keeps everything else byte for byte, and the result validates.
- A4 In VS Code a deck opens in the LabShelf deck editor; dragging, resizing, text editing, undo and theme changes write the file; the native text editor and the deck editor show each other's edits.
- A5 Presenter mode shows notes, timer, current and next slide; the full-screen view follows.
- A6 The poster preview shows the calibrated ruler in mm/in and flags text below the size threshold.
- A7 PDF export produces a PDF of the deck's page size with a system Chromium; with none available it opens the print fallback with the Chromium message; single-file HTML export opens offline.
- A8 A deck shared by link opens in the viewer and presents; revoking the link makes it unreadable; existing paper share links keep working.
- A9 Blocks linked to a paper element show out of date when the source changes.

## Non-goals

Distance simulator. PPTX export. CMYK/PDF-X. GitHub Pages publishing (a possible later option). Embedded AI inside LabShelf (separate plan). Animations and slide transitions beyond what the deck's own CSS does.

## Constraints

- Work on branch `feature/decks` in the worktree `labshelf-decks`. Do not touch other worktrees or the plans `qmd-notes`, `math-in-prose`, `notebook-flow` or anything under `packages/core/src/qmd/` beyond reading.
- Everything committed is in English. Follow documents/code.md for placement, documents/ui.md for UI, and the contracts.
