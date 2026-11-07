# Brief: talk and poster editors that are easy to use

The user finds the talk and poster editors hard to use and unintuitive. This applies to LaTeX and Typst sources most of all, and to HTML decks too. The Theme tool seems pointless to them. They reported two real bugs:

- Clicking a LaTeX block sometimes selects the next block, or a seemingly random one.
- Images do not show in the editing view, in either HTML or LaTeX decks. They show only in the preview.

This plan replaces `documents/plans/deck-workspace` and redesigns the editors around what other editors do well.

## Findings

Code map: `research/current.brief.yaml`. Reference research is summarised below.

- **Two editors behind one look.** `decks/dom/workspace/` (TeX and Typst, about 1,400 LOC) and `decks/dom/deckShell/` (HTML, about 780 LOC) duplicate the zoom, the tools and the header. `deckEditorMount.ts` still has a third toolbar of its own. Neither has tests.
- **LaTeX Visual guesses positions.** SyncTeX tags a whole beamer frame with its `\end{frame}` line, and a whole tikzposter poster with its `\end{document}` line. So blocks and elements are placed by matching words in the PDF text layer. That fails for repeated titles, math and figures. Every edit waits 800 ms plus a compile, and the outlines are cleared in the meantime.
- **Theme is a list of names.**
  - LaTeX: 43 beamer names in one menu with no preview. It is disabled outside beamer and tikzposter.
  - Typst: 6 heading colours.
  - HTML: raw `--var` rows.
- **The HTML editor lacks the basics of a slide editor.**
  - A drag moves one block only.
  - There is no marquee, copy and paste, group, distribute or rotation.
  - Bold and italic apply to the whole block.
  - There is no chart, although `feature/charts` is merged.

## References

From a web survey of Google Slides, PowerPoint, Keynote, Canva, Beautiful.ai, Figma Slides, Gamma, Pitch, Slidev, reveal.js/Quarto, Marp, Typst/tinymist, Overleaf, Better Poster, BioRender, tikzposter/baposter/peace-of-posters and Scribus.

- **Structure and geometry.** Good code-based editors (Slidev, Marp, Typst, Overleaf) do not pretend to offer free geometry. They are strong on structure: a slide grid, layouts per slide, click from preview to source and back, overflow checks, presenter view. Visual editors (Canva, Keynote, PowerPoint) offer geometry, but constrain it: smart guides, equal spacing, align then distribute, locked template chrome.
- **Themes.** No useful tool treats a theme as a list of names.
  - PowerPoint Designer and Gamma show alternatives applied to the user's own slides.
  - Canva's brand kit swaps fonts, colours and logo in one click.
  - BioRender ships templates per institution.
  - The idea to take: a small set of style tokens (palette and fonts), a template chosen at creation, and a saved institution kit.
- **Posters.** Useful poster tools share these traits:
  - Column grids with blocks that snap to them.
  - Size presets.
  - A print check: minimum font size, image resolution, margins.
  - Zoom to a block, and a minimap.
  - Better Poster as a template.

## Decisions in conversation

The user approved the proposal and the recommendation on HTML positioning. Free drag snaps strongly to the layout grid. A block that lands on the grid is written as a class or grid cell; one dropped off the grid is written in pixels.

## Non-goals

- Free x/y dragging of LaTeX or Typst blocks.
- A WYSIWYG editor for arbitrary LaTeX.
- Live preview while typing in compiled formats.
- Animations, transitions and PPTX.
- AI generation of decks.
