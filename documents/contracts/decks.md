# Contract: decks

Read when you change where decks live, the markup of `deck.html`, deck sizes, `theme.css`, linked blocks, the deck diagnostics or the deck tools of `labshelf mcp`, and when you change the templates and the gallery that create decks, Kits, Style presets, the presenter, the PDF export choices (handout, notes pages, bleed and crop marks) or the poster print check.

A deck is a talk or a poster of a writing project, written as one HTML file and one CSS file. An external Claude writes decks through `labshelf mcp`, the user edits them in the LabShelf deck editor in VS Code and the browser, and any text editor can change them. Every app reads and writes the format below and validates a deck with the core validator before it trusts it.

## Folders

A deck is an HTML file whose `html` element carries `data-deck="talk"` or `data-deck="poster"` (`detectHtmlDeckKind`), anywhere in the project. Its theme is the `theme.css` beside it. Assets are any files inside the deck's folder (the suggested place is `assets/`), referenced by relative paths that stay inside the folder. A new HTML deck is written to `talks/<name>/deck.html` or `posters/<name>/deck.html` with its `theme.css`, and the MCP tools below act only on those folders.

**New decks.** The project menu's New Talk or Poster opens the template gallery in both hosts (`DeckTemplateGalleryInit`: the kind to start on, the formats the host can create, which are `html` and, in a LaTeX project, `latex` (`deckTemplateFormats`), and the library's Kits). The user picks a kind (talk or poster), a format (`html`, or `latex` in a LaTeX project), a template, a title, a size and optionally a palette: none (`style` null, the scaffold's own look), a [Style preset](#style) or a [Kit](#kits) used as a palette variant. The choice (`DeckTemplateChoice`: `kind`, `format`, `template`, `title`, `size`, `style`, where `style` is null or a `DeckStyle`) is validated by `parseDeckTemplateChoice`, which gives null for anything else: an unknown kind, format or template, or the `typst` format, a title empty or over 200 characters after trimming, a size the format does not offer, or an invalid style. `scaffoldDeckFromTemplate(choice, name)` turns it into the files of the new deck folder: `deck.html` and `theme.css` for HTML, the main file for LaTeX. A chosen style is written as the Style section of `theme.css` for HTML ([theme.css](#themecss)) and as the `labshelf:style` block otherwise ([Style](#style)); it throws `RangeError` for a bad name, an unknown template or a size the format does not offer.

Templates (`listDeckTemplates(kind, format)`, Blank first; every template exists in HTML and LaTeX):

| Kind | Template | Content |
| --- | --- | --- |
| talk | Blank | A title slide and nothing else. |
| talk | Generic | A title slide, then Motivation, Results and Conclusion slides. |
| poster | Blank | One column: the header band and an Introduction section. |
| poster | Generic | Three equal columns: Introduction, Methods and Results. |
| poster | Better Poster | Columns `1 2 1`, header 0.08 of the canvas height: Introduction, Methods and Results on the left, the Main finding in the wide centre column as the takeaway section, then Key figure, References and Contact. |
| poster | Billboard | Columns `2 1`, header 0.16 and type scale 1.25: a double-weight Main finding as the takeaway section over a Key figure, and Methods, Results and Contact in the narrow column. |

The sizes offered (`listTemplateSizes`): HTML every preset of the kind; LaTeX talks 16:9 and 4:3 only; LaTeX posters A0 to A2 in either orientation. The poster sections come from nine section templates (Introduction, Methods, Results, Conclusion, References, Acknowledgements, Contact, Main finding, Key figure); a template's header height is a fraction of the canvas height. The MCP `deck_create` scaffold of a poster is the Generic one.

`labshelf.yaml` is not involved: apps find talks and posters by content (`listProjectDeckFiles` reads every `.html` and `.tex` file of the project), and a project lists none. The Files tree marks each one "Talk" or "Poster"; there is no separate section for them. Opening a deck HTML file opens the deck editor: VS Code reopens it from the text editor unless the user chose Reopen Deck as Text for it, and the browser opens the files the sidebar last found as decks, or a `talks/<name>/deck.html` or `posters/<name>/deck.html` before its first read.

Read also when you change source talks and posters or their workspace, below: they are not decks, but they share content detection, the Files marks, the project menu's New Talk or Poster, and the Present and Poster Preview views. In VS Code the `labshelf.activeDeckKind` context key holds the active file's kind (`talk`, `poster` or empty), read from its content; Present, Poster Preview and Reopen Deck test it.

## Source talks and posters

A talk or poster can also be written in LaTeX and shown from its built PDF. The format and the rules above do not apply to it. Any `.tex` file of the project can be one.

**Typst decks are off.** Talks and posters are HTML or LaTeX. `TYPST_DECKS_ENABLED` (`decks/typstDecks.ts`) is the one switch and is `false`: a Typst source is never a talk or poster (`detectSourceDeckKind`, `describeSourceDeck`, `readSourceDeckKind` and `isDeckFileCandidate` refuse it, so the workspace, the deck toolbar, the Files marks and `listProjectDeckFiles` leave a `.typ` file alone and it opens as a normal Typst source), the gallery never offers `typst` (`deckTemplateFormats`, `listDeckTemplates` and `listTemplateSizes` give nothing for it), `parseDeckTemplateChoice` gives null for it and `scaffoldDeckFromTemplate` throws `RangeError`. The MCP deck tools are HTML only. The Typst parsing, editing, style and poster code remains and is read here as it works when the switch is `true`; Typst as a document format is not affected.

A source is a talk or poster (`detectSourceDeckKind`) when it has a `% labshelf: talk|poster` or `// labshelf: talk|poster` comment line. Without one, LaTeX goes by its class and packages: `beamer` is a talk; `tikzposter`, `baposter`, `a0poster`, `sciposter`, `tcbposter` or a `beamerposter`, `tcbposter` or `baposter` package is a poster. Typst goes by its `@preview` imports: a known slide package or a name with `slide` or `present` is a talk, and a known poster package or a name with `poster` is a poster. New ones made by LabShelf carry the comment (`scaffoldSourceDeck`).

The outline (`readSourceDeckOutline`) has these rows:

- LaTeX talk: one slide per `\begin{frame}` outside comments. The title is the frame's first argument or `\frametitle`; a frame with `\titlepage` or `\maketitle` is "Title page".
- Typst talk: one slide per line-start `#slide`-style call when the file has any; otherwise one per `==` heading. A slide runs to the next slide or `=` heading.
- LaTeX poster: one block per `\block`, `\headerbox`, or `block`, `alertblock`, `exampleblock` or `posterbox` environment.
- Typst poster: one block per heading or `heading: [...]` argument.

Moving, duplicating and deleting a slide splice its line range in the source. The text between slides stays in place. The workspace tree of a multi-file talk also holds the slides of its included files (see [Node tree](#node-tree)).

Speaker notes are the `\note{...}` arguments of a frame, or the `#speaker-note[...]`, `#speaker-note("...")` and `#pdfpc.speaker-note(...)` calls of a Typst slide.

Present steps through PDF pages, so overlays advance one at a time. A LaTeX talk's pages map to slides through the [page map](#page-map) of LabShelf's last full build (`readTalkPages(map, mainFile, text)` gives `slideOfPage`, each page's outline slide or -1, and `unitOfPage`, a key per source unit). A page shipped by a frame of the main file maps to that frame's place in the outline, so a frame's overlay pages share its slide; a page of a section divider, of a frame of an included file or with no unit maps to no slide (no notes, labelled by page). The presenter's next box shows the first later page of another slide or divider, skipping the current slide's overlay pages. Without a page map, page n is slide n if the counts match (an HTML talk, whose page labels also group runs); otherwise pages carry no notes. `keepDeckPageMap(project, mainFile, map)` keeps the last full build's map per project and main file, and `lastDeckPageMap` reads it, for Present, handouts and the preview strip; a build without a map forgets the old one. Poster Preview shows the first page at print size (96 px per inch). It flags the PDF text runs below the size's small-text threshold and shows the print check of [Print check](#print-check).

**Presenter.** Present on an HTML talk or a compiled talk opens two views (`openPresenter`, `presenterView`): the audience view with the slides, and the presenter view with the current slide, the next slide, the speaker notes and a head with the slide label, a clock and a timer. The views stay in step through a `PresenterChannel` (`createBroadcastPresenterChannel`, a `BroadcastChannel`; `parsePresenterMessage` drops any other message). The state (`PresenterState`: slide, slide count, black screen, timer) changes only through `reducePresenter(state, action, now)`; the actions are next, previous, first, last, goto, toggle black, and pause, resume and reset the timer. Any move clears the black screen, and the first move that changes the slide starts the timer. The elapsed time is `presenterElapsedMs`, shown by `formatPresenterTime` as `m:ss`, or `h:mm:ss` from one hour. Keys (`presenterKeyAction`): ArrowRight, ArrowDown, Space and PageDown go next; ArrowLeft, ArrowUp and PageUp go back; Home and End go first and last; `b` toggles the black screen; Escape exits.

An overflow badge on a slide means the content does not fit it. In LaTeX it marks a frame whose line range holds the line of an `Overfull \vbox` warning. In Typst it marks a slide that spills onto more pages; a slide with overlay calls is never marked. A compiled poster has the same badges on its blocks, from `overflowingPosterBlocks` (see [Compiled posters](#compiled-posters)).

## Source deck workspace

The workspace edits a source talk or poster through a tree of its source (`readSourceDeckBlocks(format, kind, text)`), never through the PDF. Every edit is a splice of a node's range, so the rest of the file stays byte for byte.

### Node tree

A node (`SourceDeckNode`) is `{kind, title?, file?, range, titleRange?, bodyRange?, line, endLine, props, children?}`. `file` is the project-relative path of the included file a node of a multi-file talk comes from, and is absent on the main file's nodes. Ranges (`SourceDeckRange`) are character offsets `[start, end)` into the text. `line` and `endLine` are 1-based and inclusive. `title` is the cleaned title text, and `props.title` holds the same value. Only containers (`column`, `block`, `slide`, `columns`) have `children`.

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
- `\note`, `\frametitle`, Typst `#speaker-note` and `#pdfpc.speaker-note` open no node, and neither do comments. Content before the first slide or column is not in the tree, and neither is other text between slides, except the includes below.
- **Multi-file talks.** A talk's tree follows the includes found between slides (`readSourceDeckProject(format, kind, mainPath, read)`; `readSourceDeckIncludes` lists them for one file): LaTeX `\input`, `\include` and `\subfile` outside comments and frames, and Typst line-level `#include "…"` outside call-style slides (a heading slide's section does not count as enclosing). The slides of the included file are read recursively and stand in the tree at the include, in order; an include after the last slide adds its slides at the end. Each of their nodes carries `file`. A file counts once, at its first include; an unreadable file is skipped. `resolveSourceDeckInclude(format, fromFile, written)` gives the project-relative posix path: LaTeX resolves against the main file's folder (TeX's working folder) and adds `.tex` to a name without an extension, Typst against the including file's folder as written; it gives undefined for an absolute path, a path holding a macro (`\` or `#`) or one that leaves the project root, and such an include is skipped. Only talks are multi-file: a poster follows no includes. An edit of an included node is written to its own file, through the host's files port, outside the main editor's undo. `sameSourcePath(a, b, cwd)` tells whether two source paths name the same file, both resolved against `cwd`.
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

### Workspace views

- **Grid mode.** A compiled talk has a Grid view (`slideGrid.ts`): every slide as a thumbnail of its PDF page. Dragging a cell, or Alt with the arrow keys, reorders slides (the same splice as moving a slide). A cell's menu has Duplicate, Delete and Arrange; a double-click or Enter on a cell opens that slide.
- **Split follow.** In Split, with the Sync toggle on (the default), the source and the stage follow the selection both ways: a click on the stage or a pick in the structure selects the node's source range in the editor, and the selection in the source selects the node. A node of an included file opens that file.
- **A talk's Split.** A LaTeX or Typst talk has no Visual mode: its modes are Split, Code and Grid, and a saved or asked-for Visual opens Split, as does opening a slide from Grid. It opens in Split unless the file has a saved mode. It has no header or insert bar above the windows: the code's window and the preview's each have a bar. The code's holds Slide | File, New slide, the elements (as icons), Layout, Build and the eye; the preview's holds Grid, Aspect ratio, Style, Export and Present, and with the preview hidden Export and Present move to the code's bar. A poster's bars are the same with Block, Size, Poster and Real size, and no Grid. There are no mode tabs: Slide | File chooses whether the code shows the selected slide's lines or the whole file (with File, a pick of another slide brings the cursor to it), Grid toggles the slide grid inside the preview's window, in place of the page and the strip, with the code beside it (the workspace's mode reads "grid" and its root keeps `data-mode="split"` with `data-grid="true"`), and the eye shows the preview beside the code (Split) or hides it (Code). Code follows the cursor as Split does, with the insert bar; the editor's own toolbar is not shown for talks. Its zoom bar has only Zoom out, the zoom, Zoom in and Fit: a click always goes to the slide's code, and the page pans by scrolling or holding Space. A pinch or Cmd/Ctrl with the wheel zooms in proportion to the gesture, around the pointer, and the page is drawn sharp once the gesture rests. Its slides are a strip under the page, with a Preamble card first and a New slide card last, all of the slides' size and ratio. A section divider that the build shipped (a theme's `\AtBeginSection` page) has a card of its own in the strip and the Grid at its place, with the real page as thumbnail, a Section mark and the title from the `\section` argument; the slide numbers count frames only. A talk without a page map lists its slides alone. The editor shows one part of the main file at a time and hides the other lines as a bar above and one below (`sourceDeckSpans`): the preamble runs to the line of `\begin{document}` (LaTeX) or to the line before the first slide, and each slide runs from the line after the previous slide to its own last line, the last slide to the end of the file. The cursor cannot leave the shown lines; it is one document, so undo, review and saving see the whole file. The selection is always a whole slide or a section divider, never an element, and the stage draws no outlines. A selected divider shows its command's line in the code. Moving the cursor or typing selects the slide whose part holds it. A click on the page selects the slide or section divider the [page map](#page-map) names for that page and puts the cursor at its start; a page the map does not link (no map, a theme's own page, a text edited since the build) selects nothing. An included file's slide opens in its file and leaves the editor as it is. The Sync toggle and Reveal in preview are not shown for talks. Grid shows the whole file.
- **A poster's Split.** A LaTeX or Typst poster is edited the same way: no Visual mode (its modes are Split and Code, a saved or asked-for Visual or Grid opens Split, Split by default), no mode tabs but Block | File and the eye, no Grid. By Block the editor shows one block's lines: the preamble runs to the line of `\begin{document}` (LaTeX) or to the line before the first block, and each block of the columns, in document order in the main file, runs from the line after the previous block to its own last line, so column markers go with the block after them, the last block to the end of the file. The selection is always a whole block or the preamble, never an element; it opens on the first block. Moving the cursor or typing selects the block whose part holds it. A click on the page selects the block whose map box is the smallest holding the point and puts the cursor at the block's start; a click outside every box does nothing. The block under the pointer gets a light hover outline, the selected block keeps its outline and overflowing blocks keep theirs; outlines are the map's boxes, and a block with no box (no map, or a class the build does not hook) has none and cannot be picked on the page. A poster has no strip under the page and no block list: its blocks are picked on the page or by the cursor, the preamble by the cursor with File, and New block is in the code's bar. The zoom bar has Zoom out, the zoom, Zoom in, Fit and Zoom to section, with the minimap; a click always picks, and the page pans by scrolling or holding Space. Blocks are not dragged and column gaps are not resized on the page; Style and Poster Settings are in the preview's bar, and the editor's own toolbar is not shown.
- **Overflow badges.** Both hosts pass the located `Overfull` marks (`DeckOverflowMark`) to the workspace with the build state, and the badges follow the rules of [Source talks and posters](#source-talks-and-posters) (slides of a talk, blocks of a compiled poster).
- **Figure drop.** Dropping an image from the file tree on the stage, a Grid cell or a structure row inserts a figure for that image.
- **Compiled posters.** The block drag to a column, the gap handles and the Poster Settings button are described in [Compiled posters](#compiled-posters).

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
\setbeamercolor{frametitle}{fg=lsPrimary,bg=lsBackground}
\setbeamercolor{title}{fg=lsPrimary,bg=lsBackground}
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

**Presets.** `DECK_STYLE_PRESETS` are six built-in styles: Ocean, Forest, Ember, Slate, Plum and High contrast. Each is a valid `DeckStyle` whose contrast ratings all pass; High contrast also sets the fonts, the others keep the default fonts and scale. The Style panel offers them next to the library's [Kits](#kits). It previews up to four candidates at a time (HTML decks render the stage with the candidate, see below), lets the user edit the tokens of a candidate, shows the diff of the style block or section and the contrast warnings, and Apply writes the chosen style as one undo step.

### Source links

A LaTeX talk or poster links its source and its pages only through the [page map](#page-map) of LabShelf's last full build. SyncTeX is not used for decks (papers keep it: `parseSynctex`, `findPagePoint`, `findSourcePosition`, `findSourceBoxes`).

- The workspace gets the map in `DeckBuildState.pageMap`, sent with the build state; each new build replaces it. `createLinking(kind, mainPath)` reads it against the node tree: a page maps to a node by (file, line), the file taken from the main file's folder.
- A frame's pages (overlays, `allowframebreaks`) all belong to its slide. A `section` unit is a divider; a page whose unit is not in the tree is unlinked. A talk's strip and Grid list the slides and the section dividers in page order (`units()`); a slide the build did not ship (added since) still lists after the slides before it.
- A poster block's rectangle is its map box (`rectOf`) and a point picks the smallest box holding it (`blockAt`); a node inside a block takes the block's rectangle. Nothing is placed by titles, words or columns of the PDF's text.
- An edit moves the map's main-file lines with it (`follow`): lines before the changed run stay, lines after it shift, and a unit whose line the edit replaced is unlinked until the next build. A build that brings no map (a preview or a failure) keeps the current one. On open, the map is the last full build's: the one kept this session, else in VS Code the `.lsmap` its build folder holds (`readRootPageMap`). A PDF without a map shows its pages unlinked.
- Typst decks have no page map (they are off).

### Page map

A full LaTeX build of a project (not a preview or diff build) writes a generated package `labshelf-marks` (`createPageMarksPackage`, `PAGE_MARKS_PACKAGE`) into the build's output folder and loads it through latexmk's pretex after `labshelf-state`; the source is never changed and no extra engine pass runs. It hooks the engine, so it records what the theme or class really ships:

- a beamer `frame` environment (kind `frame`);
- `\section` and `\subsection` outside frames (kind `section`); the divider pages that a theme's `\AtBeginSection` or `\AtBeginSubsection` ships belong to the section command;
- poster blocks (kind `block`): tikzposter `\block`, beamer and beamerposter `block`, `alertblock` and `exampleblock`, tcbposter `\posterbox` and `posterboxenv`, and baposter `\headerbox` (the unit only, no box).

The build writes the sidecar `<job>.lsmap` (`derivePageMarksFileName`) into the output folder, one record per line with `|` between fields and `file` the TeX file name from the main file's folder:

- `U|<page>|<frame|section|block>|<line>|<file>`, or `U|<page>|-`: the unit open when the page shipped;
- `K|<id>|<ordinal>|<width sp>|<line>|<file>`: a block opened. An `ordinal` above 0 is the n-th block of a beamer frame, found by counting `\begin{block|alertblock|exampleblock}` in the frame's source (`placeFramedBlocks`);
- `Q|<id>|<page>|<x sp>|<y sp>|<page height sp>`: a `\pdfsavepos` point of that block.

`parseDeckPageMap(text)` and `readDeckPageMap(outDir, jobName, workDir, logger)` give a `DeckPageMap`: `pages[i]` is the unit of page i+1 as `{file, line, kind}` or null, and `blocks` lists `{file, line, page, rect}` with `rect` in PDF points from the page's top-left corner. The succeeded `LatexBuildResult` of a full build carries `pageMap?`; it is absent for other builds and when the sidecar is unreadable.

Transport: the VS Code deck host sends the map with the `deckBuild` state to the webview; the browser gets it in the Helper's `built` reply ([helper#messages](helper.md#messages)) and its deck tab passes it on. `keepDeckPageMap` keeps the last full build's map per project and main file (see [Source talks and posters](#source-talks-and-posters)) for Present, handouts and the preview's slide strip (`PreviewDeck.slideOfPage`).

### Build loop

- An edit made by the workspace (insert bar, properties, action bar, notes, style) is one undo step through `createDeckEditing`.
- 800 ms after the last such edit, the workspace builds the file's root: in VS Code through the writing view's builders (the build preview does not open), in the browser through the Helper's `compile` with mode `full`.
- Typing in Code or Split builds on save, as before.
- The header shows Build, Compiling…, Updated or Errors (n). Errors (n) opens the problems list.
- Both hosts pass the located `Overfull` marks (`DeckOverflowMark`) with the build state, which the overflow badges use.
- After an edit or a build, the selection is restored by node path (`restoreSourceDeckPath`). When that path holds another kind of node, it falls back to the nearest node of the same kind and title.

### HTML decks

VS Code and the browser open an HTML talk or poster in the deck workspace (`openDeckWorkspace`, `deckShell/`). It lays out the bare deck editor in the same `dw-*` shell as the source deck workspace:

- **Header.** The deck's name, the save state, Present (talk, with the presenter view of [Source talks and posters](#source-talks-and-posters)) or Preview (poster at real size, with the [Print check](#print-check)), Export (PDF, HTML file, Share link) and the HTML source toggle. Exporting a PDF first asks for one of the [PDF choices](#pdf-choices) of the kind. A poster has the Poster button, Zoom to section and the minimap here too (see [Compiled posters](#compiled-posters)).
- **Insert bar.** Undo, Redo, Text, Image, Equation, Shapes, New slide from a layout (talk), Style and Size.
- **Poster sections.** A poster can be laid out as a header band and sectioned columns that reflow from its Poster Settings (see [Poster sections](#poster-sections)); its other blocks stay free.
- **Left panel.** A talk has Slides (the slide strip) and Elements (the current slide's blocks). A poster has Structure (an overview and its blocks) and Elements (blocks to insert).
- **Stage.** It zooms and pans with a zoom bar (select and hand tools, Fit). A poster has cm rulers. The selected block gets a floating bar: its kind, text size, bold, italic, underline, strikethrough, colour, edit text, duplicate, delete, and order. A talk has its speaker notes under the stage (`<aside data-notes>`, `setDeckSlideNotes`).
- **Properties.** The Style tab writes `font-family`, `font-size`, `font-weight`, `font-style`, `text-decoration`, `color`, `line-height`, `text-align` and `padding`/`padding-top|right|bottom|left` on the selected block's `style` attribute (`setBlockStyle`). The base CSS makes the block's children inherit those it sets, over the theme's rules for them. A shape shows fill and stroke, an equation its TeX, an image Replace image. The Arrange tab has X, Y, W and H through the `resize` edit (cm at 96 px per inch on a poster) with a locked aspect, alignment on the slide, Bring to front and Send to back (`reorderDeckBlock`), Duplicate (`duplicateDeckBlock`) and Delete. The Style button replaces the properties with the Style panel (candidates, diff, Apply as one undo, contrast warnings).
- **Status bar.** The slide and size, the gesture hint, and the save state or the read-only deck's problems.

A shape is a block that holds one inline `<svg viewBox="0 0 100 100" preserveAspectRatio="none">` with a `rect`, `ellipse` or `line` (`shapeBlockHtml`). Its `fill`, `stroke` and `stroke-width` are edited in place (`setBlockShapeStyle`), and the validator accepts it as any other inline svg. Text, image and equation blocks come from `textBlockHtml`, `imageBlockHtml` (an `<img>` fitted to the block, picked by the host: VS Code copies a file from outside the deck into `assets/`) and `equationBlockHtml` (a `data-math="display"` leaf). Undo and Redo in VS Code run VS Code's own commands on the deck document.

Direct manipulation follows D3. Moving and resizing snap to the layout grid's lines: a block that ends on grid lines is written as the four cell classes (the `place` edit, which removes its px geometry), a block off the grid as px (`move` and `resize` drop the cell classes); holding Alt disables snapping. The `group` and `ungroup` edits set and remove `data-group` on blocks of one slide (`deckGroupMembers` lists a group). Copy, paste and duplicate work on block source (`copyDeckBlocks`, `pasteDeckBlocks`): a paste gets fresh block and group ids and, with an offset, px geometry. Align and distribute act on the selected blocks. The geometry is computed by pure modules: `snapDeckRect` (`deckSnap.ts`; guides include an equal-spacing kind, `spacing`), `groupRect`, `groupEdits`, `marqueeBlocks` and `expandGroups` (`deckGroupGesture.ts`), the align and distribute functions of `deckAlign.ts`, and the clipboard functions of `deckClipboard.ts`.

New slides from a layout (`deckSlideLayoutHtml`) place their blocks by grid cells (`col-<c> row-<r> span-<s> rows-<n>`, no px geometry); a grid too small for the layout (fewer than 2 rows, or 2 columns for two columns) falls back to px rects from the canvas.

Selection formatting. While a text leaf is open, Mod+B, Mod+I and Mod+U toggle bold, italic and underline on the selected text, Mod+K opens an in-page link input (Enter applies, empty removes, an invalid URL applies nothing), and the floating bar's and properties' bold, italic, underline, strikethrough and colour act on the selection instead of the block. A selection that is collapsed or not inside one leaf formats nothing. A paste inside a leaf inserts plain text. A leaf holding inline markup commits as `setInline` (`html` sanitised as in [#vocabulary](#vocabulary)); a leaf with only text and `<br>` commits as `setText`.

Charts. Chart in the insert bar and the Elements tab opens the figure editor; its result adds one chart block as one undo step. The properties' Edit chart button and a double-click on a chart block reopen it with the block's model; Apply or Done writes one `setChart` step (during an insert they update the inserted block). A model that cannot be read shows a toast and opens nothing.

Style candidate preview. While the Style panel has a candidate chosen, the stage renders the deck with that candidate's theme (`previewThemeCss`, through the optional `stagePreview` of the style port) without touching the deck, history or change events; apply, close and any edit clear it. Compiled decks have no stage preview.

## Vocabulary

Vocabulary version 1:

- The root element is `<html data-deck="talk|poster" data-deck-version="1" data-deck-size="<size>">`, with the size syntax of [#sizes](#sizes).
- `<head>` holds exactly one `<link rel="stylesheet" href="theme.css" data-deck-theme>`.
- Slides are `<section data-slide>` elements that are direct children of `<body>`. A talk has one or more slides; a poster has exactly one.
- Blocks are direct children of a slide carrying `data-block="<id>"`. The id matches `^[a-z][a-z0-9-]{0,39}$` and is unique in the deck. A block has its geometry in one of two forms. Either its inline `style` holds `left`, `top`, `width` and `height` in px, each a number with at most 2 decimals (width and height not negative); or it carries the four grid-cell classes `col-<c> row-<r> span-<s> rows-<n>` (whole numbers 1 to 24, in any order among other classes, `col + span - 1` at most the grid's columns and `row + rows - 1` at most its rows) and none of the four px properties. When any px property is present, the px geometry wins and the classes do not place the block. Other declarations and classes are free and kept.
- The layout grid is set in theme.css by `--deck-grid-columns` and `--deck-grid-rows` (whole numbers 1 to 24, defaults 12 and 6) and `--deck-grid-margin` and `--deck-grid-gutter` (non-negative px, defaults the canvas width / 24 and / 64, rounded to whole px); the first declaration of each counts, and a missing or invalid one takes its default. One margin is used on all four sides. With W, H the canvas in px, a column is `cw = (W - 2 margin - (columns - 1) gutter) / columns` wide and a row `rh = (H - 2 margin - (rows - 1) gutter) / rows` high; a cell's left is `margin + (col - 1)(cw + gutter)` and its width `span cw + (span - 1) gutter`, top and height the same with rows (`deckCellRect`, 2 decimals). The base CSS declares the defaults under `:where(:root)` and lays the classes out with `calc()` over the four variables (`deckGridCss`).
- Blocks that share a `data-group="<id>"` value form a group (the id follows the block id pattern and is not a block id). Groups are flat: no wrapper element and no nesting, and a block is in at most one group.
- Speaker notes are one `<aside data-notes>` that is a direct child of a slide.
- Math is `<span data-math>TeX</span>` (inline) or `<div data-math="display">TeX</div>` (display), holding TeX source.
- Chart block: a block with `data-chart="<FigureModel JSON, attribute-escaped>"` (`"v": 1`, at most 128 KB) holding one `<img>` whose `src` is a `data:image/png;base64,` or `data:image/svg+xml` URL, fitted to the block (`chartBlockHtml`). The image is what shows and exports; `data-chart` is what the chart editor reads (`readDeckChart`, `setDeckChart`).
- A text leaf is an element inside a block whose children are only text, `<br>` and the phrasing elements `a b i em strong u s sub sup small mark code span`, or math elements, and which is not itself inside another leaf. A math element is a leaf. Only leaves are edited as text. The block element itself is not a leaf, so text meant to be edited sits in an element inside the block.
- Inline markup written by the editor (`sanitizeDeckInline`) is limited to: text, `<br>`, attribute-free `b strong i em u s sub sup small mark code`, `<span style="color: C">` with C a hex, `rgb()/rgba()/hsl()/hsla()`, `var(--name)` or named colour, and `<a href="H">` with a safe href. Any other element is unwrapped (its text kept; `script` and `style` content dropped). A safe href (`safeDeckHref`) is `http:`, `https:` or `mailto:`, a `#fragment`, or a relative path with no scheme; every other scheme (`javascript:`, `data:`, …) is refused.
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
- posters: `mm` or `in`, positive numbers with at most 1 decimal, each side 100..2438.4 mm, that is up to 96 in (in converted at 25.4 mm/in).

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

## Poster sections

A sectioned poster is a poster whose slide has at least one block with `data-poster="section"`. The pure modules are `posterSections.ts` (reading) and `posterSectionEdits.ts` (edits); no new diagnostic code exists for them. A sectioned poster opens in the shell's poster stage and panel (`shell/html/`, styled by `poster.css`) instead of the free-block stage.

- **Markup.** The header band is one block `data-poster="header"` holding an `<h1>` title and a `<p>` with the authors. A section block carries `data-column="N"` (0-based integer) and an optional `data-weight="W"` (positive number, at most 2 decimals, default 1). Both stay ordinary `data-block` direct children of the slide with px geometry in `style`, so DECK009, DECK011, the parser, the overlay and the export treat them as any block. Order inside a column is document order. A block without `data-poster` is a free block (logo, QR code) that reflow never touches. An invalid or missing value reads as its default (column 0, weight 1); a column beyond the last reads as the last column. A poster without sections behaves as before.
- **Content.** A section holds plain HTML: an optional `<h2>`, paragraphs and lists, and figures as `<figure><img src alt><figcaption>…</figcaption></figure>`, so a caption stays attached to its picture.
- **Poster Settings.** Custom properties of the first `:root` rule of theme.css: `--poster-columns` (1 to 6 space-separated positive ratios, default `1 1 1`), `--poster-section-margin`, `--poster-content-margin`, `--poster-header-height` (px lengths, at most 2 decimals) and `--poster-type-scale` (0.5..2, default 1). With W × H the canvas in px, the defaults are a section margin of the shorter canvas side / 40, a content margin of the shorter side / 80 and a header height of H × 0.12, each rounded to 2 decimals. An invalid value reads as its default.
- **Reflow.** With m the section margin: the header sits at left m, top m, width W − 2m and the header height. The body starts at 2m + header height (m without a header) and ends m above the bottom. Column i is (W − 2m − (n − 1)m) × r_i / Σr wide, the columns spaced by m from left m. The sections of a column share the body height less (k − 1)m by weight, spaced by m. Every value is rounded to 2 decimals; a column with no section stays an empty slot. Reflow writes only the left, top, width and height of the header and section blocks (other declarations kept, cell classes removed), and the five `--poster-font-*` variables. The gaps are the m-wide strips between adjacent columns over the body height and the m-tall strips between adjacent sections of a column.
- **Edits.** Each edit reflows before returning deck.html and theme.css (the theme unchanged when the edit did not change it). Moving a section sets its `data-column` and moves its text (with its line when alone on it) before the index-th section of the target column, the index clamped. Resizing a column gap moves width between the two columns and rewrites `--poster-columns` as ratios with 2 decimals summing to the column count; resizing a section gap moves weight between the two sections. Each side keeps at least 10% of the column area or of the column's section height. Settings check their values (margins ≥ 0, header height > 0, 1 to 6 positive ratios, a size within the poster range, set without scaling). Switching the orientation swaps the sides (a preset becomes its other orientation) and scales a set header height by new height / old height. A new section is `<div data-block data-poster="section" data-column><h2>title</h2><p>Text</p></div>`, after the column's last section; a new figure goes at the end of its section's content.
- **Type.** `posterTypeSizes` gives px from the small text floor of the size (`smallTextThresholdPt`): caption 1×, body 1.33×, authors 1.75×, heading 2× and title 3.5× the floor, times the type scale. The base CSS pads sections by the content margin, stacks their content in a clipping flex column, fits figures and sizes `h1`, `h2`, `p`, `li`, `figcaption` and the header's `p` from `--poster-font-title|heading|body|caption|authors`; a block's own text style still wins.
- **New posters.** A new poster is written from a template of [New decks](#folders) (`DeckPosterLayout`: the column ratios, the header height as a fraction of the canvas height, the type scale and the sections, each with its column and optional weight). The scaffold writes the header band (the name as `h1` and an authors line) and the template's sections in their columns, reflowed, and the Poster Settings in theme.css. The Generic template writes the Introduction, Methods and Results sections in columns 0, 1 and 2 (also what the MCP `deck_create` writes); Blank, Better Poster and Billboard have their own columns, header height and type scale. A template can mark one section as the poster-takeaway section (the main finding), which the scaffold writes with the `takeaway` flag of its layout. LaTeX and Typst posters get the same columns, sections and type scale in their source (`scaffoldSourcePoster`).

### Compiled posters

The layout of a LaTeX or Typst poster is read and written by the pure `sourceDeckPoster.ts`, with source lengths in `sourceDeckPosterLengths.ts`. Every edit is one `SourceDeckChange` that changes only the shapes below; content stays byte for byte.

- **Templates.** tikzposter (`\documentclass{tikzposter}`), beamerposter (`\usepackage{beamerposter}`) and typst (any Typst poster; the column-boxes of peace-of-posters stay unsupported). `readSourcePosterLayout` returns null for a talk, an unknown template or a poster without columns (a LaTeX `\column`/`column` environment, a Typst `#columns` or `#grid` call). It never throws.
- **Lengths.** `<number><unit>` with mm, cm, in or pt (pt = 1/72 in for both formats) reads as mm rounded to 2 decimals; anything else (em, fr, %, macros) reads null. Written lengths are `<n>mm` or `<n>cm` with at most 2 decimals and no trailing zeros.
- **Ratios.** LaTeX reads one fraction per column from its header (`\column{0.5}`, `\begin{column}{0.45\textwidth}`) and writes fractions summing to 1 with 2 decimals (the last column takes the remainder), replacing only the number. Typst `#grid(columns: (1fr, 2fr), …)` reads the fr tracks (`columns: 3` reads three 1s, a non-fr track reads null) and writes tracks summing to the column count, 2 decimals, a single column as `(1fr,)`; `#columns(n, …)` reads n equal ratios. Writing ratios to `#columns(n, gutter: g)[A #colbreak() B]` rewrites the call as `#grid(columns: (…fr), gutter: g, <other named args>,` then one `  [` … `],` cell per column without the `#colbreak()` lines, then `)`; a call without a gutter gets `gutter: 4%`, the `#columns` default.
- **Gap resize.** Width moves from column i + 1 to column i over the column area: page width − 2 × margin − (n − 1) × gap (Typst: `#set page` width, or an ISO A paper with `flipped`; LaTeX: the tikzposter `aNpaper` option or the beamerposter `size=aN`, the long side when landscape). Each column keeps at least 10% of the area. Null when the gap index is out of range or the page width is unknown.
- **Spacing.** tikzposter: documentclass options `margin` (outer margin, default 0 mm) and `colspace` with `blockverticalspace` (section gap, both written, `colspace` read, default 15 mm), written in mm, existing keys replaced in place, new ones appended. Typst: `margin:` of `#set page(…)` (a single length; a dictionary margin reads null and is not written) and `gutter:` of the columns call (absent reads 0 for `#grid` and null for `#columns`), written in cm when the replaced value (or for a new gutter, the page margin) used cm, else mm. beamerposter reads null for both and is not written.
- **Orientation.** tikzposter swaps its `portrait`/`landscape` class option (absent reads portrait, `landscape` is appended); beamerposter sets `orientation=landscape|portrait` in its package options (absent reads portrait); Typst swaps the `width:` and `height:` values of `#set page`, or for a named paper (`"a0"` or `paper:`) toggles `flipped: true` (absent reads false). Ratios, spacing and content do not change.
- **Block moves.** A block (LaTeX `\block`/`block` environment, Typst `= Heading` with its body up to the next heading or `#colbreak()`) moves with its whole lines to before the index-th block of the target column (clamped; past the end goes after the last block, an empty column takes it at the start of its body), re-indented to the target's blocks. Within one column the index is the block's final index.
- **Overflow.** A block flagged by this rule gets an overflow badge, as a slide does. `overflowingPosterBlocks` gives the `c.b` keys (column and child index, as the linked view keys blocks) of LaTeX blocks whose lines hold an `Overfull \vbox` mark of their file, and for Typst (main file `.typ`) every block of the last column when the build has more than one page.
- **No header height.** tikzposter, beamerposter and Typst titles have no height parameter LabShelf can rely on, so compiled posters have no header-height setting.
- **Zoom to section and minimap.** Every poster, HTML or compiled, has a Zoom to section button in the zoom bar and the key Z: they fit the selected section (HTML sectioned poster) or else the selected block to the stage, and do nothing with no selection. A poster minimap over the stage draws the page outline, the section or block boxes and the visible viewport 160 px wide; a click or drag pans, and it is hidden when the whole page is visible. Talks have neither.

### Print check

The print check of a poster (`checkPosterPrint`, a pure module with no DOM and no pdfjs) turns the measured page, the text boxes and the image placements, all in mm from the page's top left, into print issues. It never throws, and it skips non-finite or non-positive sizes. A compiled poster's boxes come from its PDF (text runs and image placements, `deckPrintCheckPdf.ts`); an HTML poster's from its rendered blocks (`posterPrintCheck.ts`), where the preview resolves the images at full resolution so the DPI is that of the file. The issues, in this order:

- `lowDpi`: an image whose pixels per inch at its print size (the lower of the two axes, rounded) are below `PRINT_MIN_DPI` (150).
- `margin`: one issue per page edge with items closer to it than `PRINT_SAFE_MARGIN_MM` (10 mm), giving the count and the closest item. Items that span 90% of the page in either direction are not counted.
- `underfill`: at most one, when the content (items that do not cover 90% of the page in both directions) fills less than `PRINT_MIN_FILL` (0.7) of the page height or width; it names the dimension, the filled share and the emptier edge.

`describePrintIssue` gives the one-line text: "Image at N DPI at print size (needs 150)", "N items within 10 mm of the E edge, closest D mm" and "Content fills P% of the page H; the E is empty". Poster Preview (`openPosterPreview`) lists the issues under the small-text list, draws canvas markers for them, and an entry centres the view on its item.

**Poster PDF choices.** `POSTER_PDF_CHOICES` is what a host asks before exporting a poster's PDF, in order: PDF (the trim size, as built), PDF with 3 mm bleed, and PDF with 3 mm bleed and crop marks. A choice with `PrintMarksOptions` `{bleedMm, cropMarks}` goes through `addPrintMarks`, which adds to every page a bleed of the mirrored page edges, a `TrimBox` and `BleedBox`, and, with `cropMarks`, crop marks outside the trim. The bleed is at most 20 mm.

## theme.css

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

**Applying.** In this version a Kit applied from the Style panel writes only its Style tokens, through the format's style block ([Style](#style) for LaTeX and Typst, the Style section of [theme.css](#themecss) for HTML decks), as one undo step. Its logo and footer are stored and shown in the panel but not written into decks yet.

**In the gallery.** The template gallery of [New decks](#folders) offers the Style presets and the library's Kits as palette variants: choosing one sets `DeckTemplateChoice.style` to its Style, which the new deck is written with, and choosing none leaves `style` null. Only the Style is used there too, not the logo or footer.

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

### PDF choices

Exporting a PDF first asks for a choice, in both hosts and for every format (HTML, LaTeX and Typst); the file written is the laid-out PDF.

**Talks** (`TALK_PDF_CHOICES`, in order): PDF (one slide per page), Handout with 2, 3, 4 or 6 slides per A4 page (the 3-per-page layout has lines for notes), and Notes pages (each slide above its speaker notes). `layoutTalkPdf` builds a handout or notes pages from the talk's slide PDF and a `TalkPdfNotes` (the notes of each outline slide, the notes' markup and, for a LaTeX talk, `slideOfPage` and `unitOfPage` from `readTalkPages` of the [page map](#page-map)); a slide is a run of consecutive pages of one source unit and a page with no slide has no notes, as [Source talks and posters](#source-talks-and-posters) describes. Without them (an HTML talk's export) page n is slide n when the counts match, and a run of equal page labels (`readPdfPageLabels` gives the labels of the PDF's `/PageLabels`, or null without them) is one slide. An A4 sheet is 595.28 × 841.89 pt.

**Posters** (`POSTER_PDF_CHOICES`): PDF, PDF with 3 mm bleed, and PDF with 3 mm bleed and crop marks, described under [Print check](#print-check).

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
| DECK011 | error | A block whose left, top, width or height is missing from its style or not `<number>px` with at most 2 decimals, or a negative width or height; a block with a valid cell and no px geometry is checked on its cell's rect. |
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
| DECK025 | warning | A `data-chart` that is not JSON of an object whose `v` is 1; the chart shows its image but cannot be edited. |

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
