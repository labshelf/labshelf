# Contract: decks

Read when you change where decks live, the markup of `deck.html`, deck sizes, `theme.css`, linked blocks, the deck diagnostics or the deck tools of `labshelf mcp`.

A deck is a talk or a poster of a writing project, written as one HTML file and one CSS file. An external Claude writes decks through `labshelf mcp`, the user edits them in the LabShelf deck editor in VS Code and the browser, and any text editor can change them. Every app reads and writes the format below and validates a deck with the core validator before it trusts it.

## Folders

Decks live only in `talks/<name>/` and `posters/<name>/` at the project root; no other folder holds a deck. The deck is `<folder>/deck.html` and its theme `<folder>/theme.css`. Assets are any files inside the deck folder (the suggested place is `assets/`), referenced by relative paths that stay inside the folder.

`labshelf.yaml` is not involved: apps find decks by folder, and a project lists no decks.

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

## Links

A block may link to an element of the paper with two attributes:

- `data-source="figure:<project path>|eq:<label>|table:<label>|cite:<key>"`, the part after the prefix non-empty and without whitespace; a figure path is relative and stays inside the project;
- `data-source-hash="<12 lowercase hex>"`, the first 12 hex characters of the SHA-256 (through `deriveTextSha256Hex` of `core/hash`) of the source when the block was made or last updated.

The current hash is taken of:

- `figure:` the bytes of the figure file;
- `eq:` and `table:` the trimmed source text of the LaTeX or Typst environment holding the label;
- `cite:` the library record's `formatCitations().apa`, or the `.bib` entry text when the library lacks the key.

A linked block is fresh when the current hash equals `data-source-hash`, stale when it differs, and missing when the source cannot be found. The editor shows a stale block as "Out of date" with an Update action that rewrites `data-source-hash` (and, for a cite block, its text); the words carry the state, not colour. The deck copy is otherwise free to differ from its source.

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
