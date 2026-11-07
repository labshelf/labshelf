# Contract: decks

Read when you change where decks live, the markup of `deck.html`, deck sizes, `theme.css`, linked blocks, the deck diagnostics or the deck tools of `labshelf mcp`.

A deck is a talk or a poster of a writing project, written as one HTML file and one CSS file. An external Claude writes decks through `labshelf mcp`, the user edits them in the LabShelf deck editor in VS Code and the browser, and any text editor can change them. Every app reads and writes the format below and validates a deck with the core validator before it trusts it.

## Folders

A deck is an HTML file whose `html` element carries `data-deck="talk"` or `data-deck="poster"` (`detectHtmlDeckKind`), anywhere in the project. Its theme is the `theme.css` beside it. Assets are any files inside the deck's folder (the suggested place is `assets/`), referenced by relative paths that stay inside the folder. New Presentation and New Poster write `talks/<name>/deck.html` or `posters/<name>/deck.html` with its `theme.css`, and the MCP tools below act only on those folders.

`labshelf.yaml` is not involved: apps find talks and posters by content (`listProjectDeckFiles` reads every `.html`, `.tex` and `.typ` file of the project), and a project lists none. The Files tree marks each one "Talk" or "Poster"; there is no separate section for them. Opening a deck HTML file opens the deck editor: VS Code reopens it from the text editor unless the user chose Reopen Deck as Text for it, and the browser opens the files the sidebar last found as decks, or a `talks/<name>/deck.html` or `posters/<name>/deck.html` before its first read.

Read also when you change source talks and posters or their workspace, below: they are not decks, but they share content detection, the Files marks, the project menu's New Presentation and New Poster, and the Present and Poster Preview views. In VS Code the `labshelf.activeDeckKind` context key holds the active file's kind (`talk`, `poster` or empty), read from its content; Present, Poster Preview and Reopen Deck test it.

## Source talks and posters

A talk or poster can also be written in LaTeX or Typst and shown from its built PDF. The format and the rules above do not apply to it. Any `.tex` or `.typ` file of the project can be one.

A source is a talk or poster (`detectSourceDeckKind`) when it has a `% labshelf: talk|poster` or `// labshelf: talk|poster` comment line. Without one, LaTeX goes by its class and packages: `beamer` is a talk; `tikzposter`, `baposter`, `a0poster`, `sciposter`, `tcbposter` or a `beamerposter`, `tcbposter` or `baposter` package is a poster. Typst goes by its `@preview` imports: a known slide package or a name with `slide` or `present` is a talk, and a known poster package or a name with `poster` is a poster. New ones made by LabShelf carry the comment (`scaffoldSourceDeck`).

The outline (`readSourceDeckOutline`) has these rows:

- LaTeX talk: one slide per `\begin{frame}` outside comments. The title is the frame's first argument or `\frametitle`; a frame with `\titlepage` or `\maketitle` is "Title page".
- Typst talk: one slide per line-start `#slide`-style call when the file has any; otherwise one per `==` heading. A slide runs to the next slide or `=` heading.
- LaTeX poster: one block per `\block`, `\headerbox`, or `block`, `alertblock`, `exampleblock` or `posterbox` environment.
- Typst poster: one block per heading or `heading: [...]` argument.

Moving, duplicating and deleting a slide splice its line range in the source. The text between slides stays in place.

Speaker notes are the `\note{...}` arguments of a frame, or the `#speaker-note[...]`, `#speaker-note("...")` and `#pdfpc.speaker-note(...)` calls of a Typst slide.

Present steps through PDF pages, so overlays advance one at a time. Pages map to slides (`mapPagesToSlides`) through numeric page labels that never decrease (Beamer gives each overlay page its frame number). When there are no such labels, page n is slide n if the counts match; otherwise pages carry no notes. Poster Preview shows the first page at print size (96 px per inch). It flags the PDF text runs below the size's small-text threshold.

## Source deck workspace

The workspace edits a source talk or poster through a tree of its source (`readSourceDeckBlocks(format, kind, text)`), never through the PDF. Every edit is a splice of a node's range, so the rest of the file stays byte for byte.

### Node tree

A node (`SourceDeckNode`) is `{kind, title?, range, titleRange?, bodyRange?, line, endLine, props, children?}`. Ranges (`SourceDeckRange`) are character offsets `[start, end)` into the text. `line` and `endLine` are 1-based and inclusive. `title` is the cleaned title text, and `props.title` holds the same value. Only containers (`column`, `block`, `slide`, `columns`) have `children`.

- Talk: slides, then elements. A slide is a beamer `frame` (title from its first argument or `\frametitle`), or in Typst a heading or a `#slide[…]` call (title from `title: […]` or `title: "…"`, else from a heading that starts its body).
- Poster: columns, then blocks, then elements.
  - Columns are tikzposter or beamer `\column{w}` markers or `column` environments inside a top-level `columns`, or the columns of a top-level Typst `#columns(n)[…]` (split at `#colbreak()`) or `#grid(…)` (one column per content cell `[…]`). Without these, the poster is one implicit column that runs from the first node that is not `code`.
  - Blocks are tikzposter `\block{T}{…}`, the `block`, `alertblock` and `exampleblock` environments, or a Typst heading. `\headerbox` and `posterbox`, which the outline lists, are `code` here.
  - A LaTeX poster written in a beamer `frame` is read inside that frame.
- Element kinds (`SourceDeckNodeKind`):
  - `figure`: the `figure`, `figure*`, `tikzfigure` and `wrapfigure` environments; a `center`, `flushleft` or `flushright` environment that holds `\includegraphics`; a bare `\includegraphics` with any `\caption` or `\captionof` that follows it; Typst `#image`, `#figure`, or `#align(…)[#image(…)]`.
  - `equation`: `equation`, `align`, `gather`, `multline`, `eqnarray`, `flalign`, `alignat` (starred too), `displaymath`, `\[…\]` and `$$…$$`, or Typst math (`$ … $` with a space after the opening `$`, `#math.equation`).
  - `list`: `itemize`, `enumerate` and `description`, or Typst list items (`-`, `+`, `1.`, `/ term:`).
  - `table`: `table`, `tabular`, `tabularx`, `tabular*`, `longtable` and `tblr`, or Typst `#table`.
  - `columns`: a nested `columns` environment or a Typst `#columns` or `#grid`, with `column` children.
  - `text`: a paragraph of text and text commands such as `\textbf` or `\cite`, or a `center`, `flushleft` or `flushright` environment without a graphic.
  - `code`: anything else, such as an unknown environment, command or Typst call (`#v(1cm)`), or a Typst `#let`, `#set`, `#show`, `#import`, `#include`, `#if`, `#for`, `#while`, `#context` or `#{…}` statement.
- `\note`, `\frametitle`, Typst `#speaker-note` and `#pdfpc.speaker-note` open no node, and neither do comments. Content before the first slide or column, and content between slides, is not in the tree.
- An unbalanced brace (LaTeX) or bracket (Typst) ends the tree at the node that holds it. From there to the end, the source is one top-level `code` node.

### Properties

`props` (`SourceDeckProps`) holds only the properties a node carries in a known form. A form that is not there is a missing key. The readers in `sourceDeckScan.ts` find the first known form in the node's range, skipping comments. Each gives its value and the range of the literal a writer replaces (`SourceDeckPropForm`).

| Property | On | Source forms |
|---|---|---|
| `title` | slide, block | the title group (`titleRange`) |
| `src` | figure | `\includegraphics[…]{path}`, Typst `image("path")`; relative to the main file's folder |
| `width` | figure | `width=0.8\linewidth` (also `\columnwidth`, `\textwidth`; a bare `\linewidth` is 1), Typst `width: 80%` in `image(…)`; a fraction |
| `caption` | figure | `\caption{…}`, `\captionof{figure}{…}`, Typst `caption: […]` or `caption: "…"` |
| `align` | figure, text | `\centering`, `\raggedright`, `\raggedleft`; the `center`, `flushleft` and `flushright` environments; Typst `align(left\|center\|right…)` |
| `columnWidth` | column (LaTeX only) | `\column{0.5}` or `\begin{column}{0.5\textwidth}` (also `\linewidth`, `\columnwidth`, `\paperwidth`); a fraction |

`setSourceDeckProp(format, text, node, prop, value)` (`prop` is a `SourceDeckPropName`) returns a `SourceDeckChange` `{text, cursor}`, with the cursor at the end of the new span. It returns null when:

- the node is `code`;
- the node does not carry the property in a known form;
- `width` or `columnWidth` is outside 0.1 to 1;
- a text value spans lines, has unbalanced `{}` (LaTeX) or `[]` (Typst) (`isBalancedSourceText`), or has a `"` and goes into a Typst string;
- `src` is empty, or holds braces in LaTeX.

Typst columns are never read or written as `columnWidth`. How each property is written:

- `width` is written with at most three decimals in LaTeX, or as a percentage in Typst.
- `align` replaces a declaration (written as `\raggedright`, `\centering` or `\raggedleft`), renames an alignment environment in both `\begin` and its `\end`, or a Typst word. When the node has none, it is added: in LaTeX, a declaration at the start of an environment's body, after the header's options and arguments, or a `center`, `flushleft` or `flushright` environment around any other node; in Typst, `#align(…)[…]` around the node.
- `column` takes a 0-based poster column and moves a block to the end of that column's body. It moves the block's whole lines when the block stands alone on them. It returns null for a node that is not a block of a poster column, or for a column that does not exist.

`setSourceNote(format, text, slide, note)` sets the speaker note of the slide holding `slide.range[0]`:

- It replaces the first note's text and removes any later note of the slide.
- It adds a note in `insertSourceNote`'s form when the slide has none.
- An empty `note` removes every note.
- It returns null outside any slide, or when the text would not stay inside the note.

Block actions work on any node of the tree: `moveSourceDeckNode` swaps a node with its neighbour among its siblings, `duplicateSourceDeckNode` copies it after itself and `deleteSourceDeckNode` removes it, with its whole lines when it stands alone on them. A poster block at the end of its column moves into the next column through `column`. `insertSourceElement(format, text, target, kind, src?)` adds a text, figure, equation, table or list at the end of a container's body or right after an element, as its own paragraph.

A slide whose body is still a scaffold layout (`readSourceSlideLayout`) can take another one (`setSourceSlideLayout`); an edited body returns null.

### Style

A LaTeX or Typst deck keeps its look in one `labshelf:style` block of nine tokens (`DeckStyle`, `DECK_STYLE_TOKENS` in that order, `DEFAULT_DECK_STYLE` in parentheses): the colours `primary` (`#1f5673`), `accent` (`#c75b12`), `background` (`#ffffff`), `text` (`#1a1a1a`) and `muted` (`#6b7280`); the fonts `headingFont` (`Inter`), `bodyFont` (`Inter`) and `monoFont` (`JetBrains Mono`); and `scale` (`1`), the factor the base text size is multiplied by.

Value rules (`validateDeckStyle` gives one problem per bad token, naming it, and `[]` for a valid style): a colour is `#rrggbb` in lower case, and `#rgb` or upper case input is normalised on write and on read. A font is one family name, which after trimming is non-empty and matches `/^[A-Za-z0-9 ._+-]+$/` (no quotes, braces or backslashes). The scale is a number from 0.5 to 3.

`sourceDeckTemplate(format, text)` names the template, with comments ignored. In LaTeX, class `beamer` with a `beamerposter` package is `beamerposter`, otherwise class `beamer` is `beamer`, and class `tikzposter` is `tikzposter`. In Typst, an `@preview` import of touying is `touying`, one of peace-of-posters is `peace-of-posters`, and any other talk or poster (`detectSourceDeckKind`) is `typst`. Every other source gives null.

**Markers.** The block opens with `% labshelf:style` (LaTeX) or `// labshelf:style` (Typst) and closes with `% labshelf:style end` or `// labshelf:style end`. Each marker stands alone on its line, and leading spaces are allowed. The block runs from the start of the opening line to the end of the closing line, newline included. An opening marker without its end is no block.

**Placement of a new block** (an existing block is replaced in place):

- LaTeX: on the line after the last line before `\begin{document}` that starts with `\documentclass`, `\usepackage`, `\RequirePackage` or `\use<letters>` (`\usetheme`, `\usecolortheme`, `\usecolorstyle`, …). It therefore sits after the theme commands and wins over their colours.
- Plain Typst: after the last top-level preamble statement. The preamble is the leading run of blank lines, comments and statements starting with `#import`, `#set`, `#show` or `#let`, and a statement runs until its `()`, `[]` and `{}` balance (strings and comments skipped).
- touying: the same, but a `#show:` line (the show-everything rule) ends the preamble, so the block sits before `#show: <theme>.with(…)`.
- peace-of-posters: the same, and calls of `set-theme`, `update-theme`, `set-poster-layout` and `update-poster-layout` (bare or with the import alias) count as preamble, so the block sits after the theme and layout calls.

Only the newline the block needs to sit on its own lines is added before it (when the preamble ends the file without one). No other byte outside the block changes.

**Write rule.** `setSourceDeckStyle(format, text, style)` returns one `SourceDeckChange` (one undo step). It always writes the whole block in the canonical form below from the given style, so a hand edit inside the block is replaced. The cursor is the block start. The same text and style give the same text (idempotent). It returns null for an unknown template, an opening marker without its end, or an invalid style.

**The six forms** (default style). LaTeX colours are written as upper-case hex without `#`. Typst colours are written in lower case.

beamer and beamerposter:

```latex
% labshelf:style
\definecolor{lsPrimary}{HTML}{1F5673}
\definecolor{lsAccent}{HTML}{C75B12}
\definecolor{lsBackground}{HTML}{FFFFFF}
\definecolor{lsText}{HTML}{1A1A1A}
\definecolor{lsMuted}{HTML}{6B7280}
\def\lsScale{1}
\iftutex
  \usepackage{fontspec}
  \setmainfont{Inter}
  \setsansfont{Inter}
  \setmonofont{JetBrains Mono}
  \newfontfamily\lsHeadingFont{Inter}
\else
  \let\lsHeadingFont\relax
\fi
\setbeamercolor{normal text}{fg=lsText,bg=lsBackground}
\setbeamercolor{background canvas}{bg=lsBackground}
\setbeamercolor{structure}{fg=lsPrimary}
\setbeamercolor{frametitle}{fg=lsPrimary}
\setbeamercolor{title}{fg=lsPrimary}
\setbeamercolor{block title}{fg=lsBackground,bg=lsPrimary}
\setbeamercolor{alerted text}{fg=lsAccent}
\setbeamercolor{footline}{fg=lsMuted}
\setbeamerfont{frametitle}{family=\lsHeadingFont}
\setbeamerfont{title}{family=\lsHeadingFont}
% labshelf:style end
```

tikzposter (the same common lines up to `\fi`, then):

```latex
\definecolorstyle{labshelf}{\colorlet{colorOne}{lsPrimary}\colorlet{colorTwo}{lsAccent}\colorlet{colorThree}{lsMuted}}{
  \colorlet{backgroundcolor}{lsBackground}
  \colorlet{framecolor}{lsPrimary}
  \colorlet{titlefgcolor}{lsBackground}
  \colorlet{titlebgcolor}{lsPrimary}
  \colorlet{blocktitlebgcolor}{lsPrimary}
  \colorlet{blocktitlefgcolor}{lsBackground}
  \colorlet{blockbodybgcolor}{lsBackground}
  \colorlet{blockbodyfgcolor}{lsText}
  \colorlet{innerblocktitlebgcolor}{lsAccent}
  \colorlet{innerblocktitlefgcolor}{lsBackground}
  \colorlet{innerblockbodybgcolor}{lsBackground}
  \colorlet{innerblockbodyfgcolor}{lsText}
  \colorlet{notefgcolor}{lsText}
  \colorlet{notebgcolor}{lsBackground}
  \colorlet{noteframecolor}{lsMuted}
}
\usecolorstyle{labshelf}
% labshelf:style end
```

Fonts apply only under LuaLaTeX or XeLaTeX (`\iftutex`), and pdfLaTeX keeps its own fonts. `\lsScale` stores the scale for templates to use and has no effect by itself in LaTeX.

Plain Typst:

```typst
// labshelf:style
#let ls-primary = rgb("#1f5673")
#let ls-accent = rgb("#c75b12")
#let ls-background = rgb("#ffffff")
#let ls-text = rgb("#1a1a1a")
#let ls-muted = rgb("#6b7280")
#let ls-heading-font = "Inter"
#let ls-body-font = "Inter"
#let ls-mono-font = "JetBrains Mono"
#let ls-scale = 1
#set page(fill: ls-background)
#set text(font: ls-body-font, fill: ls-text, size: ls-scale * 1em)
#show heading: set text(font: ls-heading-font, fill: ls-primary)
#show raw: set text(font: ls-mono-font)
#show link: set text(fill: ls-accent)
// labshelf:style end
```

touying (the same `#let` lines, then):

```typst
#let ls-colors = config-colors(primary: ls-primary, secondary: ls-accent, tertiary: ls-muted, neutral-lightest: ls-background, neutral-darkest: ls-text)
#set text(font: ls-body-font, fill: ls-text, size: ls-scale * 1em)
#show heading: set text(font: ls-heading-font, fill: ls-primary)
#show raw: set text(font: ls-mono-font)
#show link: set text(fill: ls-accent)
// labshelf:style end
```

peace-of-posters (the same `#let` lines, then; the prefix is the import's alias, `pop.` for `as pop`, none for `: *`, the package name for a bare import):

```typst
#pop.update-theme(heading-box-args: (fill: ls-primary, stroke: ls-primary), heading-text-args: (fill: ls-background, font: ls-heading-font), body-box-args: (fill: ls-background, stroke: ls-primary), body-text-args: (fill: ls-text, font: ls-body-font))
#set text(font: ls-body-font, fill: ls-text)
// labshelf:style end
```

**What wins.** In LaTeX the block follows the theme commands, so its colours win over the theme's. In Typst, a show rule outside the block that sets its own colour (such as the plain poster scaffold's heading fill) keeps winning; LabShelf's templates use the `ls-` names instead of fixed colours. A touying theme takes the colours only when its `.with(…)` call passes `ls-colors` (the templates do this, and the user may add it).

**Read-back.** `readSourceDeckStyle(format, text)` gives the template, the block (`{from, to, text}`, or null) and the tokens it sets. It returns null when the source is no deck of a known template. Only lines inside the block are parsed, and spacing and extra lines are tolerated:

- LaTeX: `\definecolor{ls<Name>}{HTML}{RRGGBB}` (also `{rgb}{r,g,b}` from 0 to 1 and `{RGB}{r,g,b}` from 0 to 255), `\setmainfont{…}` for `bodyFont`, `\setmonofont{…}` for `monoFont`, `\newfontfamily\lsHeadingFont[…]{…}` for `headingFont`, and `\def\lsScale{n}`.
- Typst: `#let ls-<name> = rgb("#…")` (also `rgb(r, g, b)` from 0 to 255), `#let ls-<heading|body|mono>-font = "…"`, and `#let ls-scale = n`.

A token that is missing or invalid is absent from the `Partial` result. With no block, the style is `{}`.

**Diff.** `diffDeckStyleBlock(before, after)` is `compareLines` of the two block texts. An empty `before` (no block yet) gives only added lines.

**Contrast.** `deckStyleContrast(style)` rates `text` (minimum 4.5), `muted`, `primary` and `accent` (minimum 3 each) against `background`, in that order. It uses WCAG 2 relative luminance (`relativeLuminance`) and the ratio (L1+0.05)/(L2+0.05), rounded to 2 decimals, with `ok` when the ratio reaches the minimum.

### Source links

LaTeX links the source and the page through SyncTeX (`parseSynctex`, `findPagePoint`, `findSourcePosition`). `findSourceBoxes(map, file, fromLine, toLine)` returns the boxes (`SourceBox` `{page, box}`) of the file whose source line falls in `[fromLine, toLine]`, inclusive. Pages come in ascending order and nested boxes are included.

- The workspace reaches SyncTeX only through the port `links?: {boxes(fromLine, toLine), sourceAt(point)}`. Points and boxes are in PDF points from the page's top-left corner, pages 1-based. Each answers null while the build left no SyncTeX data.
- A node's rectangle is the union of its boxes on the page (`unionSourceDeckRects`), leaving out boxes that cover nearly the whole page.
- beamer reads a frame's body as an argument and tikzposter typesets the whole poster at `\end{document}`, so SyncTeX tags their content with the closing line. The workspace therefore also places nodes by the PDF's text layer:
  - `matchPosterRects` bounds a poster block from its title down to the next title in its column.
  - `matchTextRects` places an element by the union of the text runs its words hold (`plainSourceText`).
- A click on the page selects the deeper of the node SyncTeX names and the node whose text-layer rectangle holds the point.
- Typst has no SyncTeX, and the browser Helper sends none, so there the text layer alone places nodes. The stage says so in a note.

### Build loop

- An edit made by the workspace (insert bar, properties, action bar, notes, style) is one undo step through `createDeckEditing`.
- 800 ms after the last such edit, the workspace builds the file's root: in VS Code through the writing view's builders (the build preview does not open), in the browser through the Helper's `compile` with mode `full`.
- Typing in Code or Split builds on save, as before.
- The header shows Build, Compiling…, Updated or Errors (n). Errors (n) opens the problems list.
- After an edit or a build, the selection is restored by node path (`restoreSourceDeckPath`). When that path holds another kind of node, it falls back to the nearest node of the same kind and title.

### HTML decks

VS Code and the browser open an HTML talk or poster in the deck workspace (`openDeckWorkspace`, `deckShell/`). It lays out the bare deck editor in the same `dw-*` shell as the source deck workspace:

- **Header.** The deck's name, the save state, Present (talk) or Preview (poster at real size), Export (PDF, HTML file, Share link) and the HTML source toggle.
- **Insert bar.** Undo, Redo, Text, Image, Equation, Shapes, New slide from a layout (talk), Style and Size.
- **Left panel.** A talk has Slides (the slide strip) and Elements (the current slide's blocks). A poster has Structure (an overview and its blocks) and Elements (blocks to insert).
- **Stage.** It zooms and pans with a zoom bar (select and hand tools, Fit). A poster has cm rulers. The selected block gets a floating bar: its kind, text size, bold, italic, underline, strikethrough, colour, edit text, duplicate, delete, and order. A talk has its speaker notes under the stage (`<aside data-notes>`, `setDeckSlideNotes`).
- **Properties.** The Style tab writes `font-family`, `font-size`, `font-weight`, `font-style`, `text-decoration`, `color`, `line-height`, `text-align` and `padding`/`padding-top|right|bottom|left` on the selected block's `style` attribute (`setBlockStyle`). The base CSS makes the block's children inherit those it sets, over the theme's rules for them. A shape shows fill and stroke, an equation its TeX, an image Replace image. The Arrange tab has X, Y, W and H through the `resize` edit (cm at 96 px per inch on a poster) with a locked aspect, alignment on the slide, Bring to front and Send to back (`reorderDeckBlock`), Duplicate (`duplicateDeckBlock`) and Delete. The Style button replaces the properties with the Style panel (candidates, diff, Apply as one undo, contrast warnings).
- **Status bar.** The slide and size, the gesture hint, and the save state or the read-only deck's problems.

A shape is a block that holds one inline `<svg viewBox="0 0 100 100" preserveAspectRatio="none">` with a `rect`, `ellipse` or `line` (`shapeBlockHtml`). Its `fill`, `stroke` and `stroke-width` are edited in place (`setBlockShapeStyle`), and the validator accepts it as any other inline svg. Text, image and equation blocks come from `textBlockHtml`, `imageBlockHtml` (an `<img>` fitted to the block, picked by the host: VS Code copies a file from outside the deck into `assets/`) and `equationBlockHtml` (a `data-math="display"` leaf). Undo and Redo in VS Code run VS Code's own commands on the deck document.

## Vocabulary

Vocabulary version 1:

- The root element is `<html data-deck="talk|poster" data-deck-version="1" data-deck-size="<size>">`, with the size syntax of [#sizes](#sizes).
- `<head>` holds exactly one `<link rel="stylesheet" href="theme.css" data-deck-theme>`.
- Slides are `<section data-slide>` elements that are direct children of `<body>`. A talk has one or more slides; a poster has exactly one.
- Blocks are direct children of a slide carrying `data-block="<id>"`. The id matches `^[a-z][a-z0-9-]{0,39}$` and is unique in the deck. A block has an inline `style` holding `left`, `top`, `width` and `height` in px, each a number with at most 2 decimals (width and height not negative). Other declarations in that attribute are free and kept.
- Speaker notes are one `<aside data-notes>` that is a direct child of a slide.
- Math is `<span data-math>TeX</span>` (inline) or `<div data-math="display">TeX</div>` (display), holding TeX source.
- A text leaf is an element inside a block whose children are only text, `<br>` and the phrasing elements `a b i em strong u s sub sup small mark code span`, or math elements, and which is not itself inside another leaf. A math element is a leaf. Only leaves are edited as text. The block element itself is not a leaf, so text meant to be edited sits in an element inside the block.
- Every non-void element is closed explicitly; there are no implied end tags. A start tag ending in `/>` is an empty element. The void elements are `area base br col embed hr img input link meta source track wbr`.
- Inside a block, HTML and CSS are free, within the rules of [#diagnostics](#diagnostics) (no scripts, no unsafe references).

Example talk:

```html
<!doctype html>
<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">
<head>
  <meta charset="utf-8">
  <title>Results</title>
  <link rel="stylesheet" href="theme.css" data-deck-theme>
</head>
<body>
  <section data-slide>
    <div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>
    <aside data-notes>Greet the audience.</aside>
  </section>
  <section data-slide>
    <div data-block="body" style="left: 120px; top: 320px; width: 1680px; height: 600px;">
      <p>The ratio is</p>
      <div data-math="display">\frac{a}{b}</div>
      <img src="assets/plot.png" alt="Plot">
    </div>
  </section>
</body>
</html>
```

## Sizes

`data-deck-size` is `<w>x<h><unit>` with a lowercase `x` and unit and no spaces:

- talks: `px`, positive integers without leading zeros, each side 320..7680;
- posters: `mm` or `in`, positive numbers with at most 1 decimal, each side 100..2000 mm (in converted at 25.4 mm/in).

Bounds are inclusive. Writers drop trailing zeros (`841x1189mm`, `36x48in`, `100.5x200mm`).

Presets, in this order:

| Kind | Id | Label | Size |
| --- | --- | --- | --- |
| talk | `talk-16-9` | 16:9 | `1920x1080px` |
| talk | `talk-4-3` | 4:3 | `1440x1080px` |
| talk | `talk-16-10` | 16:10 | `1920x1200px` |
| poster | `a0-portrait` | A0 portrait | `841x1189mm` |
| poster | `a0-landscape` | A0 landscape | `1189x841mm` |
| poster | `a1-portrait` | A1 portrait | `594x841mm` |
| poster | `a1-landscape` | A1 landscape | `841x594mm` |
| poster | `a2-portrait` | A2 portrait | `420x594mm` |
| poster | `a2-landscape` | A2 landscape | `594x420mm` |
| poster | `arch-e-portrait` | ARCH E portrait | `36x48in` |
| poster | `arch-e-landscape` | ARCH E landscape | `48x36in` |
| poster | `poster-36x48in` | 36 × 48 in | `36x48in` |
| poster | `poster-48x36in` | 48 × 36 in | `48x36in` |

Any other size within the ranges above is a valid custom size.

The canvas is the slide's coordinate system in px. A talk's canvas is its size as written. A poster's canvas is its physical size at 96 px/in (mm / 25.4 × 96, in × 96), each side rounded to 2 decimals; A0 portrait gives 3178.58 × 4493.86 px. Block geometry is always in canvas px.

Changing the size with `scale` set (the editor sets it) multiplies each block's `left` and `width` by new width / old width and `top` and `height` by new height / old height, in canvas px; blocks without valid geometry stay as they are. Without `scale` only `data-deck-size` changes.

## Theme

Theme values are CSS custom properties (`--name`) in the first top-level rule of `theme.css` whose selector is exactly `:root`. The editor lists and edits only those; the rest of the file is free CSS.

An edit changes only the value of one property, the last declaration of that name in the rule. A property the rule lacks is appended at the end of the rule; when the file has no `:root` rule, a new `:root` rule is appended at the end of the file. Every other byte stays.

**Style section.** The nine Style tokens of [Style](#style) are kept as one section of custom properties inside that same `:root` rule, written by `setThemeStyle(css, style)` and read by `readThemeStyle(css)`. The names keep those the scaffold already uses where the meaning matches, so scaffolded slides restyle:

| Token | Property | Value |
| --- | --- | --- |
| `primary` | `--deck-primary` | `#rrggbb` |
| `accent` | `--deck-accent` | `#rrggbb` |
| `background` | `--deck-bg` | `#rrggbb` |
| `text` | `--deck-fg` | `#rrggbb` |
| `muted` | `--deck-muted` | `#rrggbb` |
| `headingFont` | `--deck-heading-font` | one family name, as written (`Inter`) |
| `bodyFont` | `--deck-font` | one family name, as written |
| `monoFont` | `--deck-mono-font` | one family name, as written |
| `scale` | `--deck-scale` | unitless number from 0.5 to 3 |

```css
:root {
  /* labshelf:style */
  --deck-primary: #1f5673;
  --deck-accent: #c75b12;
  --deck-bg: #ffffff;
  --deck-fg: #1a1a1a;
  --deck-muted: #6b7280;
  --deck-heading-font: Inter;
  --deck-font: Inter;
  --deck-mono-font: JetBrains Mono;
  --deck-scale: 1;
  /* labshelf:style end */
}
```

The section is the line `  /* labshelf:style */`, one `  --name: value;` line per token in the order above, and the line `  /* labshelf:style end */`, placed at the end of the rule so its values win over earlier declarations of the same names. A rule without the section gets it appended at its end; a file without a `:root` rule gets `:root {`, the section and `}` appended at the end of the file (after a newline when the file does not end in one); an existing section is replaced in place. Every byte outside the section stays, and writing the same style again gives the same text. `setThemeStyle` returns null for an invalid style or an opening marker without its end line.

Reading looks only inside the section: declarations are parsed like the other theme properties (comments and strings are skipped, spacing and extra lines are tolerated), colours come back as lower case `#rrggbb`, and a token whose value is invalid is absent. With no section, the same names are read from the `:root` declarations (the last of a name wins), so a scaffolded deck gives `background`, `text` and `accent` from `--deck-bg`, `--deck-fg` and `--deck-accent`; its `--deck-font: system-ui, sans-serif` is not one family name, so `bodyFont` is absent. `readThemeProperties` and `setThemeProperty` see the section's lines as ordinary `:root` declarations.

## Kits

A Kit is a named [Style](#style) with an optional logo and footer, kept in the library so every deck can reuse it (`decks/deckKit.ts`, `deckKitStore.ts`, `deckKitPalette.ts`). Each Kit is one file `<library root>/kits/<slug>.json`. The slug is the name in lower case, NFKD with combining marks removed, every run of characters outside `[a-z0-9]` turned into one `-`, leading and trailing `-` trimmed, cut to 60 characters (then trailing `-` trimmed again); an empty slug is `kit`. Saving a Kit whose slug exists overwrites it: the same name is the same Kit.

```json
{
  "version": 1,
  "name": "Universidade de São Paulo",
  "style": {
    "primary": "#0b5394",
    "accent": "#b45f06",
    "background": "#ffffff",
    "text": "#1a1a1a",
    "muted": "#6b7280",
    "headingFont": "Inter",
    "bodyFont": "Inter",
    "monoFont": "JetBrains Mono",
    "scale": 1
  },
  "logo": "kits/universidade-de-sao-paulo.png",
  "footer": "IF - USP"
}
```

The file is that object with 2-space indentation and a final newline, keys in that order, the style keys in token order with colours as lower case `#rrggbb`; `logo` and `footer` are left out when absent. Reading drops the file (the Kit is not listed) when it is not JSON, not an object, its `version` is not `1`, its `name` is not a string or is empty after trimming or longer than 80 characters, or its `style` lacks one of the nine tokens or fails their rules. The name is trimmed. `logo` is kept only when it is `kits/<file>` with a file name holding no `/`, `\` or `..` and an extension `png`, `jpg`, `jpeg`, `svg`, `webp` or `gif` (any case); `footer` is kept only when it is a string of at most 200 characters after trimming, and an empty one is dropped. A bad logo or footer is dropped and the Kit kept; unknown keys are ignored. Listing reads every `*.json` of `kits/` (a missing folder gives none), skips unreadable or invalid files and sorts by name, case-insensitively.

A logo saved with a Kit is written beside it as `kits/<slug>.<ext>`, the extension taken in lower case from the picked file, and the Kit's `logo` is that path, `/`-separated and relative to the library root. Saving refuses another image type ("Unsupported image type.") and an image over 5 MB ("The image is larger than 5 MB."), and writes nothing then.

**From a logo.** The palette of an image counts its pixels with alpha of at least 128 in buckets of the top 4 bits of each channel, takes each bucket's mean colour, and merges a bucket within RGB distance 48 of a more frequent colour into it, giving up to six colours, most frequent first. The Style it gives keeps the fonts, scale, background, text and muted of the current style, takes the first chromatic colour (HSL saturation at least 0.25, relative luminance from 0.02 to 0.9) as `primary` and the next one at least 30 degrees of hue away as `accent`, each mixed toward black on a light background (white on a dark one) in 5 % steps until its contrast with the background is at least 3.

**Applying.** In this version a Kit applied from the Style panel writes only its Style tokens, through the format's style block ([Style](#style) for LaTeX and Typst, the Style section of [Theme](#theme) for HTML decks), as one undo step. Its logo and footer are stored and shown in the panel but not written into decks yet.

**Panel and hosts.** The Style panel has a Kits section that lists the library's Kits, applies one, saves the current Style as a Kit with an optional logo, and builds a Style from a logo's palette. The host gives it a `DeckKitsPort` (`list`, `save`, `pickImage`). In VS Code the HTML deck editor's page sends `{ type: "kits", id, request: "list" | "save" | "pickImage" }` and the host answers `{ type: "kitsResult", id, ok: true, value }` or `{ type: "kitsResult", id, ok: false, error }`; the compiled editor carries the same three requests as `deckKits`, `deckSaveKit` and `deckPickKitImage` of the writing protocol, with logo bytes as base64.

## Links

A block may link to an element of the paper with two attributes:

- `data-source="figure:<project path>|eq:<label>|table:<label>|cite:<key>"`, the part after the prefix non-empty and without whitespace; a figure path is relative and stays inside the project;
- `data-source-hash="<12 lowercase hex>"`, the first 12 hex characters of the SHA-256 (through `deriveTextSha256Hex` of `core/hash`) of the source when the block was made or last updated.

The current hash is taken of:

- `figure:` the bytes of the figure file;
- `eq:` and `table:` the trimmed source text of the LaTeX or Typst environment holding the label;
- `cite:` the library record's `formatCitations().apa`, or the `.bib` entry text when the library lacks the key.

A linked block is fresh when the current hash equals `data-source-hash`, stale when it differs, and missing when the source cannot be found. The editor shows a stale block as "Out of date" with an Update action that rewrites `data-source-hash` (and, for a cite block, its text); the words carry the state, not colour. The deck copy is otherwise free to differ from its source.

## Export

A deck exports to one offline HTML file: its local assets and fonts become data URIs, `theme.css` and the base layout CSS (the same `deckBaseCss` the editor frame uses) are inlined, math is pre-rendered, keyboard navigation is included, and opening it with `#print` applies the print layout (`deckPrintCss`, one slide per page at the deck size). The file makes no network request.

## Diagnostics

The core validator `validateDeck(html, {theme?, files?})` is pure and deterministic: the same input gives the same list. Each diagnostic is:

```ts
{ code: string; severity: "error" | "warning"; slide?: number; block?: string; file?: "theme.css";
  line: number; column: number; message: string; hint: string }
```

- `line` and `column` are 1-based; the column counts UTF-16 code units from the line start, and `\r\n` is one line break.
- `slide` is the 0-based index of the slide holding the location and `block` the id of the block holding it, each only when one holds it.
- Diagnostics found in the theme carry `file: "theme.css"` with line and column in the theme text.
- `message` names what was found; `hint` is the rule's fix in one line.

The list is sorted deck diagnostics first, then theme ones, each by line, column, code, then message.

Errors block an MCP write: the write is refused with the diagnostics. Warnings never block. An app opens a deck with errors read-only, showing its diagnostics.

The location is the offending start tag, the attribute name for attribute rules, `url(` for CSS references, the property name for CSS rules, the `data-deck-size` value for DECK003 and DECK004, the `<body` tag for DECK005 (1:1 without a body), and 1:1 for DECK001 without an html element and for DECK024.

An asset reference is checked in `src`, each `srcset` candidate, `poster`, `href` of `<link>`, `href` and `xlink:href` of SVG `<image>` and `<use>`, and every CSS `url()` in style attributes, style elements and the theme. `href` of `<a>` is not an asset reference (only DECK013 applies to it), so a link to an http(s) page is allowed.

| Code | Severity | Trigger |
| --- | --- | --- |
| DECK001 | error | No html element, no body, or `data-deck` missing or not `talk` or `poster`. |
| DECK002 | error | `data-deck-version` missing or not `"1"`. |
| DECK003 | error | `data-deck-size` missing, malformed or outside the range for its kind. |
| DECK004 | error | The size unit does not fit the kind (talk with mm or in, poster with px); reported instead of DECK003 for that case. |
| DECK005 | error | No slide: body has no `<section data-slide>` child. |
| DECK006 | error | A poster with more than one slide (on each slide after the first). |
| DECK007 | error | An element with `data-slide` that is not a section direct child of body. |
| DECK008 | error | Theme link missing, more than one (on each extra), not in head, or without `rel="stylesheet"` and `href="theme.css"`. |
| DECK009 | error | An element with `data-block` that is not a direct child of a slide, or that is inside another block. |
| DECK010 | error | A block id that does not match `^[a-z][a-z0-9-]{0,39}$`, or repeats an earlier id (on the repeat). |
| DECK011 | error | A block whose left, top, width or height is missing from its style or not `<number>px` with at most 2 decimals, or a negative width or height. |
| DECK012 | warning | A block whose rect leaves the slide canvas (left or top below 0, left + width or top + height above the canvas); only when size and rect are valid. |
| DECK013 | error | A script element, an attribute whose name starts with `on`, or a `javascript:` URL in any attribute (value trimmed, ASCII whitespace and control characters removed, compared case-insensitively). |
| DECK014 | error | An iframe, object, embed, frame, frameset, form or base element, or a meta with `http-equiv` refresh (case-insensitive). |
| DECK015 | error | An unsafe asset reference: an absolute path (`/`), a scheme other than `data:` (http:, https:, file:, blob: and any other), a protocol-relative `//`, or a relative path whose normalised form leaves the folder (`..` above the root). A `url()` of only `#fragment` is allowed. |
| DECK016 | warning | When `files` is given, a safe relative reference whose normalised path (leading `./` removed, `%xx` decoded, `?query` and `#fragment` dropped) is not in `files`; `data:` URLs and fragments are never checked. The theme link's `theme.css` is checked the same way. |
| DECK017 | error | A slide with more than one notes element (on each extra), or an `aside data-notes` that is not a direct child of a slide. |
| DECK018 | warning | A notes element in a poster. |
| DECK019 | error | A `data-math` element whose TeX has unbalanced braces (`{` and `}` not preceded by a backslash; a `}` before its `{` counts). |
| DECK020 | error | `data-source` on an element that is not a block, a value not of the form `figure:<path>`, `eq:<label>`, `table:<label>` or `cite:<key>` with a non-empty rest without whitespace, a figure path that is absolute or leaves the project, or a `data-source-hash` that is not 12 lowercase hex. |
| DECK021 | warning | A block with `data-source` and no `data-source-hash`. |
| DECK022 | warning | Heavy CSS: any `backdrop-filter` declaration, a `filter` declaration inside `@keyframes`, or a `transition` or `transition-property` naming filter; in style attributes, style elements and the theme. |
| DECK023 | error | Malformed markup: an unterminated comment, tag or quoted value, a duplicate attribute, or an unclosed, mismatched or stray tag. |
| DECK024 | warning | `theme` is given and its first `:root` rule has no custom property. |

DECK013, DECK014, DECK015, DECK016, DECK019, DECK022 and DECK023 apply to every input; the other rules need a deck structure, and when there is no html or body element DECK001 alone stands for them. DECK015, DECK016 and DECK022 on the theme's CSS, and DECK024, apply only when `theme` is given. Each rule gives one diagnostic per occurrence.

## MCP

`labshelf mcp [--project <folder|id>]` serves the decks of one writing project to an MCP client over stdio. The project is the folder or id given, else the project holding the working directory. The protocol is JSON-RPC 2.0, one message per line, version 2025-06-18 (`initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`); stdout carries nothing but JSON-RPC and logs go to stderr. The command exits 0 when the client closes the input, 2 when no project is found and 1 for any other failure, writing nothing to stdout in those cases. The server's instructions tell the client to call `deck_rules` before writing a deck.

Every tool has an object `inputSchema` with `additionalProperties: false` and answers one text content holding the result as JSON (indented by 2). A refused call sets `isError` and answers `{"ok": false, "error": "<sentence>", "diagnostics": [...]}` where `error` or `diagnostics` may be absent; an argument of the wrong type is refused the same way and the error names the argument. A deck argument is the project-relative folder `talks/<name>` or `posters/<name>`, with or without a trailing `/` or `/deck.html`; any other path is refused with `Decks live in talks/<name>/ or posters/<name>/ of the project.`

| Tool | Arguments | Result |
| --- | --- | --- |
| `deck_rules` | none | `{folders, vocabulary, presets, rules}`: `["talks/<name>/", "posters/<name>/"]`, the vocabulary above as one-sentence strings, the talk then poster size presets and every diagnostic rule. |
| `project_context` | `part` (`outline`, `section`, `figures` or `bibliography`), `heading?`, `cursor?` | `{text, cursor?}`: one page of at most 64 KB; `cursor` is where the next page starts and is absent on the last. |
| `deck_list` | none | `{decks: [{kind, name, folder, file, theme}]}`, talks then posters. |
| `deck_read` | `deck` | `{deck, html, theme, files, diagnostics}`: `theme` is `""` without a theme.css, `files` are deck-folder-relative paths sorted. |
| `deck_create` | `name`, `kind` (`talk` or `poster`), `html?`, `theme?`, `assets?` (`[{path, base64}]`) | `{ok: true, deck, diagnostics}` with the warnings. Without `html` the scaffold of the kind is written, and without `theme` the scaffold theme. Refused when `<root>/<name>/deck.html` exists. |
| `deck_edit` | `deck`, `html?`, `edits?` (DeckEdit list), `theme?`, `assets?`; at least one of the four | Same result as `deck_create`. It starts from `html` or the stored deck.html, applies the edits in order (the first failing edit refuses with its error), takes `theme` or the stored theme.css, validates, and writes only the files that changed. |
| `deck_validate` | `deck?` or `html?`, `theme?` | `{diagnostics}` of the given html (with the theme when given) or of the stored deck; it never writes and diagnostics are never an `isError`. |

An asset path is relative to the deck folder, has no `..` and is not `deck.html` or `theme.css`; an asset decodes to at most 5 MB (5242880 bytes) or the call is refused with `Asset <path> is larger than 5 MB.`

Writes are confined. Before writing, the tool resolves the real path of the project folder; the deck folder must resolve to exactly `<project>/<talks|posters>/<name>`, so a symlinked `talks/`, `posters/` or deck folder that leads elsewhere is refused with `The deck folder resolves outside the project.` Each written file must have a parent folder that resolves inside the deck folder, and an existing target that is a symbolic link is refused. Nothing is written on any refusal.

Errors refuse a write: `deck_create` and `deck_edit` validate the whole deck as it would be stored (theme, files and the given assets included) and refuse with all the diagnostics when any is an error. Warnings never refuse a write; they come back in `diagnostics` of the result.
