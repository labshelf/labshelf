# BioRender Poster Builder: what to take

This is a web survey of the product page, help-centre snippets, template pages, webinars and reviews. The help centre returned 403, so some points come from search snippets. The editor itself is behind a login.

## Model
- A poster is a tree of smart sections. Each section holds at most one header plus content blocks: text, an image with an attached caption, or a graph.
- Sections are dragged in from an Insert Content panel. When one moves, its neighbours resize so that nothing overlaps or leaves the canvas.
- Hovering the gap between two boxes shows a blue line. Dragging it resizes the neighbours.
- Poster Settings holds:
  - size, in inches up to 96, with presets 48×36, 42×36, A0 and A1;
  - orientation;
  - section margin, content margin and header height;
  - the theme colour.
- Switching orientation reflows the whole layout in one click.
- Text blocks have preset print-sized fonts and spacing, so pasted text is already right.

## Start
- The flow is template first: pick size, orientation and colour theme up front, or close the window for a blank poster.
- Many templates are per institution (landscape, portrait, square, light and dark), alongside generic Classic and Billboard styles.

## Other
- Pan with Space-drag; zoom with Alt-wheel or a slider; Preview mode.
- Comments, real-time co-editing and version history.
- Export to PNG, JPG or PDF at 72, 150 or 300 DPI.

## Gaps LabShelf can fill
These come from reviews and absent features:
- every export carries a watermark;
- there is no print preflight, bleed or crop marks;
- there are no tables, equations, references or QR insert;
- reviewers call the posters bland and template-like.

## Applicability
- **HTML posters:** everything applies.
- **LaTeX and Typst posters:** the same controls apply when mapped to source. That means columns and width ratios, blocks, and lengths, changed on release and then recompiled. Free placement and live reflow do not apply.
