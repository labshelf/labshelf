# Contract: qmd item files

Read when you change how LabShelf reads or writes a `.qmd` file of notes, comments or discussion messages.

Every place a user writes outside LaTeX or Typst is a `.qmd` item file: one file per case (all notes of a paper, one discussion thread), holding one item per note, comment or message. The files sit in libraries, projects and Spaces that sync tools and other people's apps change, and users open them in Quarto or any text editor, so the format cannot change without breaking files already on disk. Every app reads and writes it the same way.

## Format

An item file is UTF-8 text in "LabShelf Markdown", a subset of [Quarto Markdown](https://quarto.org/docs/authoring/markdown-basics.html). The editor shows paragraphs with emphasis, strong and inline code, ATX headings, bullet, ordered and task lists, inline and display math (`$$…$$ {#eq-<label>}`), code cells (`#|` options kept verbatim), cell results ([Outputs](#outputs)), images, paper links (`[text](labshelf:…)`, [links.md](links.md#grammar)) and citations (`[@key]`).

- Any other Markdown (tables, block quotes, callouts, raw HTML, front matter) is kept as a raw block: shown as source, written back unchanged, never dropped.
- A file read and written back without an edit is byte-identical: line endings, a missing final newline and a leading byte order mark included. Any other edit changes only the bytes of what it edits. A block or inline syntax that would not write back to its exact bytes stays raw or literal text.
- A code fence follows Pandoc: three or more `` ` `` or `~`, and it counts only when a closing fence of the same character, at least as long, follows it. An unclosed fence is ordinary text.

## Items

An item is a top-level fenced div whose opening line carries the class `labshelf-item` and an id:

```
::: {#n-01JB2Q8Z5K7M3V9X4C6T8R2W0Y .labshelf-item anchor="p10 box 0.12 0.4 0.3 0.1" author="Ana" created="2026-10-22T09:12:00.000Z"}
The bound is tight when $\epsilon \to 0$.
:::
```

- The body is every byte between the opening and closing lines. The closing line is the first line of only colons at the same nesting depth; lines inside code fences do not count.
- Attributes: `anchor`, `author`, `created`. Any other class or attribute is kept, in order, when LabShelf rewrites the item.
- A body LabShelf writes never changes how the rest of the file reads: every div and fence it opens, it closes. LabShelf reads the file again before writing and rejects an edit after which any other part reads differently.
- Anything that is not an item (front matter, text between items, a div without `labshelf-item` or an id) is loose text, kept byte for byte in place.
- An opening line whose div is never closed is loose text, and reading goes on: the items after it are still items. This differs from Pandoc, which closes the div at the end of the file, on purpose. One broken item never hides the rest.
- Ids are unique in a file, but a hand edit may repeat one. Every item with the repeated id is still shown and kept.

## Ids

An item id is `n-` plus a [ULID](https://github.com/ulid/spec). Any device creates ids without coordination, and they sort by creation time. An id is never reused and never changes, also when the item moves or its anchor changes. LabShelf reads any non-empty id, so hand-written ids work; it creates only this form.

## Anchors

`anchor` says what an item is attached to: nothing, a highlight of the paper (`hl:<annotation id>` in the paper's `data.json`, [library-format.md](library-format.md#sidecar-datajson)), a text box on a PDF page (`p<page> box <x> <y> <w> <h>`, fractions of the page from the top-left, like highlights) a note pin on a PDF page (`p<page> point <x> <y>`, positive integer page and coordinates from 0 to 1, at most four decimal places, independent of any highlight), or a passage of a project text file (`quote:<base64url>` of the JSON `{quote, prefix, suffix}`, the rules of a comment anchor in [library-format.md](library-format.md#project-folder-labshelf)). A quote is never empty, except in the anchor of an item with `suggestion="delete"` ([Comments](#comments)).

An anchor in no known form, or one that breaks its rules, is kept verbatim and the item is shown as not attached.

## Comments

A project's comment threads, review comments and suggestions are the items of `.labshelf/comments.qmd`, one item per comment:

```
::: {#t1 .labshelf-item anchor="quote:…" file="main.tex" resolved="true" author="Ana" created="2026-10-16T09:12:00.000Z"}
Which baseline?
:::

::: {#c2 .labshelf-item thread="t1" author="Bo" created="2026-10-17T10:00:00.000Z"}
The one in Table 2.
:::
```

- The first comment of a thread carries the thread: its id is the thread's id, `anchor` is the thread's quote anchor ([Anchors](#anchors)), `file` the POSIX path of the text file relative to the project folder, `resolved="true"` only when the thread is resolved, and `start`/`end` (base64 Yjs relative positions) only in a shared project ([collaboration.md](collaboration.md#comments)).
- The first item has `comment="<comment id>"` only when the first comment's id differs from the thread id; without it the thread id is the comment id.
- A reply is an item with `thread="<thread id>"` and no anchor.
- `author` and `created` are the comment's; the body is the comment's text in LabShelf Markdown, the item body without its last line ending.
- Thread order is the order of their first items; reply order is file order. Items merge per id ([Merge](#merge)), so two replies written offline both survive.
- Existing thread and comment ids are kept as written; new ones are created as in [Ids](#ids).
- Git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>` lines) outside items make the file unreadable, and LabShelf never overwrites it. Any other text reads; an item that is not a valid comment, unknown attributes and text outside items are kept on a rewrite.

A pending suggestion is an item with a `suggestion` attribute:

```
::: {#s1 .labshelf-item suggestion="delete" file="main.tex" anchor="quote:…" group="g1" author="Bo" created="2026-10-18T08:00:00.000Z"}
a strong
:::

::: {#s2 .labshelf-item suggestion="insert" file="main.tex" anchor="quote:…" group="g1" author="Bo" created="2026-10-18T08:00:00.000Z"}
:::
```

- The proposal is applied: the file on disk holds the suggested text, and the PDF compiles it. Inserted text stays in the file; deleted text is removed from the file and kept only in the suggestion.
- `suggestion` is `insert` or `delete`; `file` is the POSIX path of the text file relative to the project folder; `anchor` is a quote anchor ([Anchors](#anchors)), with `start`/`end` only in a shared project, as for a thread. An insert's anchor quotes the inserted text and its body is empty. A delete's anchor has an empty quote with its prefix and suffix marking the position, and its body is the deleted text, non-empty, the item body without its last line ending.
- `group` is present only on a replacement: a delete and an insert sharing a `group` are accepted or rejected together. `author` and `created` (ISO time) are the suggestion's.
- A suggestion is re-found like a thread: by its live positions in a shared project, else by its quote with context, else it is listed as detached.
- Accepting a suggestion removes its item and leaves the file as it is. Rejecting an insert removes its range from the file; rejecting a delete inserts its text back at its position; then the item is removed. Nothing keeps an accepted or rejected suggestion: the file's history is the record.
- Suggestion items are written after all threads, sorted by `created` then id. Threads and other items keep their bytes, and items merge per id ([Merge](#merge)).

## Project notes

A project's notes are the `.qmd` files in its `notes/` folder, one file per note: `notes/<slug>.qmd`. The files are listed by name; a note's title is the first `# ` heading of its first item, else the file name without `.qmd`.

- The slug is the title as lowercase ASCII words (accents removed) joined by `-`, or `note` when the title has no words. A taken slug gets `-2`, `-3`, … The first item of a new note has the body `# <title>`.
- A task-list line (`- [ ] text` or `- [x] text`, also `*` and `+` bullets, indented lists included) inside an item body is a task of the project's Checklist ([library-format.md](library-format.md#project-folder-labshelf)). Lines in code fences, in output blocks and outside items are not tasks. A task is identified by its file, item id and line.
- Ticking a task in the Checklist edits only the box character of that line, through the item's body ([Items](#items)). When the note does not hold that task, with that text and state, on that line, nothing is written and the toggle reports `changed`.
- "Send to…" appends one item to a note, with the id of the sent item. The body by payload, blocks separated by one blank line:
  - quote: the selection as a block quote, then `[<key>, p. <page>](labshelf:…)` ([links.md](links.md#grammar)).
  - equation: `$$` … `$$` around the LaTeX, then the same paper link.
  - figure: `![](assets/<item id>.png)`, then the same paper link. The PNG is written first, in `assets/` next to the note, and the item only after that write succeeded.
  - item: the body of the source item, then `[Source](<source path>#<item id>)`.
- The recent "Send to…" targets (at most 8, most recent first) are per device, in the app's own storage. They are never in the library or the project.

## Outputs

A code cell's result follows the cell inside the same item, as a fenced div with the class `labshelf-output` and the attributes `cell`, `source`, `engine` and `ran`, plus `params` when the cell has [parameters](#cell-parameters). `engine` is the cell's language ([Cell languages](#cell-languages)). Results travel inside the file, so a reader sees them without running anything.

- `cell` is the cell's `#| label:`. A cell with a result has a label.
- `source` is the first 12 hex characters of the SHA-256 of the cell's code with the `#|` lines removed, lines joined with `\n` and trailing line endings removed. Every device must compute it the same way, and line endings must never make a result out of date.
- `params` lists the parameter values the result was made with: `name=value` pairs sorted by name and joined by `;`, numbers in shortest round-trip form, strings JSON-quoted, booleans `true` or `false` (`params="beta=0.9;label=\"a\";log=true"`).
- A result whose `source` differs from its cell's current code, or whose `params` differ from the values of its cell's param lines, is shown as out of date. A result and a cell that both lack parameters compare by `source` alone. A result whose cell is gone, or that lacks `cell` or `source`, is shown as text.
- A result that would close its block early is rejected, not written.
- A failed run (an error or a timeout) writes its error text in a plain fenced code block and adds `status="error"` as the opener's last attribute; a successful result has no `status`. A cancelled run, or one whose language is not installed, writes nothing.
- Warnings and run time are not stored in the output block: a run with warnings writes the same block as one without, and the warnings and the run time show only for runs made in the open view (a reopened note shows the stored result and its `ran` time only).
- A run writes its block on the line after the cell's closing fence, and a rerun replaces the cell's block in place. A cell without a label gets `#| label: cell-<n>` (its 1-based position among the item's cells) on its first run.

An output may contain one Markdown image with an embedded PNG (`![Python plot](data:image/png;base64,…)`); a newly written image's alt is `<Language> plot` (`Python plot`, `R plot`, `Mathematica plot`) and a stored alt is read as written. Images come from Python, R and Mathematica cells. It is a stored figure, shown directly by each host; rerunning a cell replaces its output as usual. Other image formats and remote URLs are not plot results. A returned Matplotlib figure, a plotting command, or the last open figure when the cell returns no value is captured as PNG. Explicitly returned PNG data URLs are accepted too. Matplotlib is required by cells that import it.

A plot output may also carry its data as a `labshelf-plot` spec, so a host can draw it as an interactive 2D or 3D plot:

````markdown
![Python plot](data:image/png;base64,…)

```{=labshelf-plot}
{"v":1,"dim":2,"axes":{"x":{},"y":{}},"traces":[{"type":"line","x":[0,1],"y":[0,1]}]}
```
````

- The PNG line comes first, then one blank line, the line ```` ```{=labshelf-plot} ````, the spec JSON on one line, and a closing ```` ``` ```` line. An output without a PNG holds the fence alone. LabShelf writes `\n` inside the content and converts it to the file's line ending; readers accept `\n` or `\r\n`, surrounding whitespace and extra blank lines between the parts. Content holding anything else (a second image, text, another fence) is not a plot.
- Pandoc and Quarto ignore the raw `labshelf-plot` format and show the PNG. A host without the plot renderer, or one that reads a missing or invalid spec, shows the PNG too.
- A spec is version `v: 1`. Numbers are rounded to 4 significant digits, a line or points trace keeps at most 2000 points (decimated beyond that), and a whole spec holds at most 20000 triangles (a mesh counts its faces, a surface 2 per grid cell). A spec whose JSON exceeds 256 KB (262144 UTF-8 bytes) is dropped and the output keeps the PNG alone.

### Cell parameters

A cell declares parameters among its leading `#|` lines, one line each, with the same syntax in every language:

- `#| param: <name> = slider(<min>, <max>, <value>[, step = <s>][, log])`
- `#| param: <name> = select(<a>, <b>, …; <value>)`, choices being numbers or double-quoted strings with `\"` escapes
- `#| param: <name> = checkbox(<true|false>)`

Spaces around tokens are free. A name matches `^[A-Za-z][A-Za-z0-9_]*$`, and a cell has at most 8 parameters; a malformed line, a bad name or a ninth parameter is kept as text and draws nothing. A slider value outside `[min, max]` is clamped when read, not rewritten. The value is the last argument and is the only part LabShelf rewrites: every other byte of the line, its line ending included, stays as written. Like every `#|` line, param lines do not count towards `source`.

- Values reach the driver as data, never as code: the request carries `params: {name: value}`. Python sets them in the note's scope, R assigns them in the global environment, Mathematica sets `Global`<name>` from the parsed JSON value. Each driver checks the names again and rejects its own reserved names; the note's other variables stay.
- Moving a control runs a preview at once, with at most one in flight per cell: the latest value wins and nothing is cancelled. A preview whose figure has a spec answers the spec alone, and the shown figure updates in place. The cell draws its params as a strip of native controls (a range, a select or a checkbox, labelled by name, with the value beside it), also while the code is folded. A preview's result is shown under the cell, in place of the stored output, or as a temporary output after a cell that has none, until the release run ends; it is never written. An output whose `params` differ from the cell's param lines is marked out of date with the caption "the parameters changed". Releasing the control writes the new value into its param line and runs the cell once more as a normal run, which writes the output with its `params`. A normal run sends the cell's pending edit to the host before the run starts, so the stored output is not overwritten by a later save of an older body. Previews time out after 20 s.
- Mathematica: when a cell's last value is `Manipulate[body, specs…]`, the driver evaluates `body` with the request's params, or each control's initial value, returns that frame, and adds `controls: [{name, kind, min?, max?, step?, choices?, value}]`. A cell without param lines draws those controls; the first release writes them as `#| param:` lines, and from then on the lines win. `Animate` and `Dynamic` stay errors.

### Cell languages

Cell languages are `python`, `mathematica` and `r`, written as the fence ```` ```{python} ````, ```` ```{mathematica} ```` and ```` ```{r} ````, the same syntax as Quarto and Pandoc. A fence with any other language is kept as text and has no Run action.

- The Node cell runner runs each cell through a driver file shipped with core next to the runner (`@labshelf/core/qmd/compute/node/`): `cellDriver.py` in the Python interpreter (setting, `python3`/`python` on PATH, then managed Python), `cellDriver.wl` in the `WolframKernel` found beside `wolframscript` (`-noprompt -script`, because `wolframscript -file` waits for stdin EOF), `cellDriver.R` in `Rscript --vanilla`. One driver process per note and language keeps variables between that note's cells; languages never share variables.
- Driver protocol: the runner writes one JSON request per stdin line, `{id, code, params?, preview?}`. The driver answers with one JSON line on stdout that starts with the sentinel `\u0001LABSHELF\u0001` and carries `{id, latex?|text?|error?, plot?, controls?}`. With `preview: true`, a figure that yields a labshelf-plot spec answers the spec alone, without the PNG. Anything else on stdout or stderr is the cell's printed output, so prints never desync results. A launch can ask for a ready handshake: the driver then writes one sentinel line `{ready: true}` after start-up, and output before it goes to the log instead of a cell (the Mathematica launch uses it, so kernel start-up banners never reach a cell).
- A response line can be large (a PNG data URL), so the runner never caps line length. Drivers read UTF-8, accept CRLF line endings and exit on stdin EOF, so a dead parent never leaves a driver running.
- Cancel and timeout kill that language's process for that note, killing its process group. The next run starts a fresh process, and its result carries `restarted: true`, shown as "<Language> restarted, earlier definitions are gone". "Restart <Language>" in a cell header kills the process without running. Process start-up time does not count towards the timeout.
- A run whose language has no executable ends with status `missing` and writes nothing.
- Math lines: `ICellRunner.runMath` evaluates a LaTeX expression of the prose in the note's `mathematica` driver after the cells above it, and answers with the result's LaTeX or an error. It writes no output block; its answer becomes an [inline result](#inline-results). The expression reaches the driver as data, never as code.

### Inline results

A result of a math expression written in prose is stored in the paragraph as a Pandoc span, so a reader sees it without running anything:

````markdown
The area is [$x^2 = 4$]{.labshelf-result engine=mathematica-14.1 source=3f9a1c0b7d2e} in total.
````

- The span is `[$<tex>$]{.labshelf-result engine=<engine> source=<source>}`: the text between the brackets is exactly one inline math (Pandoc's `$…$` rules), then the attribute block with the class `labshelf-result`, then `engine` and `source` in that order, one space between the parts. Pandoc and Quarto show the typeset math and drop the attributes.
- `tex` is the text between the dollar signs, as the user wrote it plus the result. `engine` is the engine and version that made it (`mathematica-14.1`); it is a non-empty word. `source` is a non-empty word: the first 12 hex characters of the SHA-256 of the JSON array `[<expression>, <cell>, …]`, the expression being the normalised LaTeX of the expression without its trailing `=` or `\approx`, and the cells being the code strings of every code cell above the result in note order (a cell below the result does not count). Editing the expression or any cell above makes the result out of date; editing a cell below does not.
- A span with `engine` missing, an unknown attribute or class, the attributes in another order, an unclosed attribute block, no math or two maths inside is not a result and is kept as text; `[$x$](url)` stays a link.
- A result whose LaTeX contains `$`, `]` or a line ending, or is empty, is never written: the writer refuses it and the editor shows an error.
- A result is read in paragraphs, headings, list items and quotes, never in code fences.
- The editor shows a result as typeset math after its inline math (one space between), and a result is a single atom: it is deleted whole, not edited. A math ending in `=` asks for an evaluation, one ending in `\approx` for a numeric one, and an equation for a solution. A result whose `source` no longer matches its expression and the cells above is shown out of date, with Recompute in its hover card. Notes the editor cannot compute for (read-only, no runner) show the result without those actions.

### Drawings

A drawing is a figure made in the note editor. It is stored in the item body as one top-level fenced div with the class `labshelf-drawing`, holding five parts in this order:

`````markdown
::: {.labshelf-drawing source=3f2a9c01b7de}
```{=latex}
\makeatletter\@ifundefined{tikzpicture}{\iftrue}{\begin{tikzpicture}[x=0.5cm,y=0.5cm]
\draw[->] (0,0) -- (4,0);
\end{tikzpicture}\iffalse}\makeatother
```

![](data:image/png;base64,…){width=6.35cm fig-alt="Drawing A B"}

```{=latex}
\fi
```

```{=labshelf-svg}
<svg xmlns="http://www.w3.org/2000/svg" …>…</svg>
```

```{=labshelf-drawing}
{"v":1,"points":[…],"items":[…]}
```
:::
`````

- The guard: a raw `latex` fence whose content is exactly `\makeatletter\@ifundefined{tikzpicture}{\iftrue}{<tikzpicture>\iffalse}\makeatother`. When TikZ is loaded, LaTeX typesets the `tikzpicture` and `\iffalse` skips the PNG; without TikZ, `\iftrue` lets the PNG through.
- The PNG: one Markdown image line `![](data:image/png;base64,…){width=<cm>cm fig-alt="<alt>"}`, the rendered drawing. `width` is its physical width, the drawing's extent at 0.5 cm per grid unit (the SVG's px width at 96 px per inch, rounded to 0.01 cm); readers also accept the line without it. In the alt, `\` and `"` are escaped with `\`; it holds no line break.
- The closing fence: a raw `latex` fence holding exactly `\fi`.
- The SVG: a raw `labshelf-svg` fence with the drawing's SVG, written on one line, which the editor shows.
- The model: a raw `labshelf-drawing` fence with the model JSON on one line, which the editor edits.
- `source` is the first 12 hex characters of the SHA-256 of the `tikzpicture` text with `\n` line endings. A block whose `source` differs from that hash was edited by hand: LabShelf still shows its SVG and model, and marks it hand-edited, so redrawing would overwrite the edit.
- LabShelf writes `\n` inside the block and converts it to the file's line ending; readers accept `\n` or `\r\n` and extra blank lines between the parts. A div holding anything else (a part missing or out of order, a different guard or closing fence, a paragraph between parts, an invalid model) is not a drawing and is kept as text. A block over 256 KB (262144 UTF-8 bytes) is not written and is not read as a drawing.
- A reader without LabShelf sees the TikZ figure in LaTeX output, the PNG in HTML, Word and other Pandoc or Quarto output (the `latex` fences are dropped there), and nothing of the `labshelf-svg` and `labshelf-drawing` fences, which Pandoc and Quarto skip.
- In the editor, a label, a function expression and an axes range or axis label are typed in a field placed in the drawing. A label or curve that does not parse shows its source in a red dashed box, the editor names it in a status line, and Done, Esc and a click outside do not commit while one is broken.

The model is version `v: 1`: `{v: 1, points, items}`.

- A point is `{id, x, y, label?, at?, dot, on?}`. `id` is a non-empty string; `at` is one of the eight TikZ compass anchors (`north`, `south`, `east`, `west`, `north east`, `north west`, `south east`, `south west`); `dot` is a boolean; `on: {item, x}` pins the point to a function curve, `item` being the index of a `fn` item and `x` the math x.
- An item has a kind `k`:
  - `seg`: `{a, b, arrow, bend?, label?, side?, style?}`, `a` and `b` point ids, `arrow` `none`, `end` or `both`, `side` `left` or `right`.
  - `circle`: `{c, r, style?}`, `c` a point id, `r` positive.
  - `rect`: `{a, b, style?}`, opposite corners as point ids.
  - `poly`: `{pts, closed, style?}`, at least two point ids.
  - `text`: `{x, y, tex}`.
  - `axes`: `{id, o, x, y, sx, sy, ticks, xlabel?, ylabel?}`, `o` the id of the point at the origin, `x` and `y` ranges `[lo, hi]`, `sx` and `sy` grid units per math unit (positive), `ticks` a boolean.
  - `fn`: `{axes, expr, domain?, label?, style?}`, `axes` the id of an `axes` item, `domain` a range. `expr` is kept as written; an expression that does not parse leaves the model valid.
- A style is `{color?, dash?, thick?, fill?}`, `dash` being `dashed` or `dotted`.
- Points and axes share one id space. A model with an unknown `v`, an unknown kind, a duplicate id, an id that names nothing (a point id, an axes `o` or a `fn` `axes`), an `on.item` that is not a `fn`, a non-finite number or an empty or reversed range is invalid. Coordinates, radii, ranges and `on.x` are rounded to 0.01. Optional fields are absent when unused, and unknown keys are dropped.

### Charts

A chart is a function plot or a data chart made in the chart editor and shown with Plotly. It is stored in the item body as one top-level fenced div with the class `labshelf-chart`, holding these parts in this order:

`````markdown
::: {.labshelf-chart source=8c1e02d4a7f3}
```{=latex}
\makeatletter\@ifundefined{pgfplotsset}{\iftrue}{\begin{tikzpicture}
\begin{axis}[…]
\addplot[domain=-5:5,samples=100]{sin(deg(x))};
\end{axis}
\end{tikzpicture}\iffalse}\makeatother
```

![](data:image/png;base64,…){width=16cm fig-alt="Chart of sin(x)"}

```{=latex}
\fi
```

```{=labshelf-chart}
{"v":1,"id":"0a1b2c3d","kind":"fn2d",…}
```
:::
`````

- The pgfplots part is optional. When present it is the guard, a raw `latex` fence whose content is exactly `\makeatletter\@ifundefined{pgfplotsset}{\iftrue}{<tikzpicture with axis>\iffalse}\makeatother`, then the optional PNG line, then a raw `latex` fence holding exactly `\fi`. With pgfplots loaded LaTeX typesets the picture and `\iffalse` skips the PNG; without it, `\iftrue` lets the PNG through.
- Without the pgfplots part the block holds only the optional PNG line, then the model.
- The PNG is optional: one Markdown image line `![](data:image/png;base64,…){width=<cm>cm fig-alt="<alt>"}`, the chart as last rendered. In the alt, `\` and `"` are escaped with `\`; it holds no line break.
- The model: a raw `labshelf-chart` fence with the model JSON on one line, in canonical key order.
- `source` is the first 12 hex characters of the SHA-256 of the pgfplots picture (with `\n` line endings) when the block has one, else of the model JSON line. A block whose `source` differs from that hash was edited by hand: LabShelf still reads it and marks it hand-edited, so rewriting it would overwrite the edit.
- LabShelf writes `\n` inside the block and converts it to the file's line ending; readers accept `\n` or `\r\n` and extra blank lines between the parts. A div holding anything else (a part missing or out of order, a different guard or closing fence, a paragraph between parts, a model that is not one line of valid JSON or not a valid model) is not a chart and is kept as text. A block over 256 KB (262144 UTF-8 bytes) is not written and is not read as a chart. An unedited chart is written back byte for byte.
- A reader without LabShelf sees the pgfplots figure in LaTeX output, the PNG in HTML, Word and other output, and nothing of the `labshelf-chart` fence.
- In the editor the block is one chart node, shown with Plotly from the model. The note outline lists it as `Chart: <title or kind label>`. When Plotly cannot draw it, the node shows the stored PNG under the label "Shown as stored image".

The model is version `v: 1`: `{v: 1, id, kind, title?, data?, src?, traces, fns, vars, layout}`, a validated subset of a Plotly figure.

- `id` is 8 lowercase hex characters; `kind` is `data`, `fn2d` or `fn3d`.
- `data` is the inline table `{cols: [{name, values}]}`, each value a finite number, a string or `null`. A table whose model JSON would reach 65536 bytes is written instead as CSV (RFC 4180, comma, header row, `\n`) to `assets/<id>.csv` beside the note, and the model holds `src: "assets/<id>.csv"` instead of `data` (written from the chart editor's data import on). `src` is a relative path under `assets/` ending `.csv` with no `..`, `.` or empty segment; a model with both `data` and `src` is invalid.
- A table over 64 KB lives in `assets/<id>.csv` beside the note: the model holds `src` and no `data`. On save the CSV is written first, then the block, so a failed CSV write leaves the block unchanged. A table that shrinks back under the limit is stored inline again. Deleting a chart keeps its CSV.
- A chart whose CSV is not found (no file, a failed read, or a host without a note-files port) keeps the stored PNG, shows "Data file <src> not found", and its data grid is read-only; the chart is not rewritten from the missing table.
- A host gives the editor the `NoteFilesPort` (`packages/core/src/qmd/noteFiles.ts`): `read(path)` returns the bytes or null, `write(path, bytes)` and `pickTextFile(accept)` returns `{name, text}` (UTF-8, at most 10 MB) or null. `safeNotePath` accepts only a relative POSIX path under `assets/` with no empty, `.` or `..` segment, backslash or drive letter; hosts refuse any other path. Over a webview boundary the port is the request `noteFile.read` / `noteFile.write` / `noteFile.pick` (each with a `requestId`; a write carries `base64`, a pick the `accept` list), wrapped in the reader's `noteFile` command, the library pane's `paper.noteFile` and the Spaces `space.noteFile` message, which add the note identity the host already uses. The host answers with a `NoteFileReply` `{type: "noteFile.reply", requestId, base64? | file? | error?}` under the same `requestId`: `base64` null is a missing file, `file` null a cancelled pick, `error` a failure. Core answers a request for every surface with `answerNoteFileRequest` (`packages/core/src/qmd/noteFileIo.ts`) over a `LibraryFileSystem`, a path join and a file picker, and never rejects: a thrown error becomes `error`. The reader (`ReaderHostPorts.noteFiles`), the library pane (`LibraryUiHost.noteFiles`) and Spaces (`ServeSpacesOptions.noteFiles`) each take an optional hook that returns the reply; without it they post `unsupportedNoteFileReply`, an `error` reply, so a client never waits.
- A trace is `{type, name?, x?, y?, z?, mode?, fill?, transpose?, colorscale?, color?, opacity?, showlegend?, orientation?, hole?, lineWidth?, markerSize?}`. `type` is one of `scatter`, `bar`, `pie`, `heatmap`, `contour`, `surface`, `mesh3d`, `scatter3d`, `histogram`, `box`. `x` and `y` are column letters (`A`…`Z`, then `AA`, `AB`, …) and `z` a list of them; `opacity` is between 0 and 1. `orientation` is `v` or `h` (a bar drawn horizontally, its X column on the vertical axis); `hole` is the donut hole of a pie, from 0 up to but not including 1; `lineWidth` and `markerSize` are positive numbers. `mode` is `lines`, `markers` or `lines+markers`; `colorscale` (on a trace or the layout) is one of `Blackbody`, `Bluered`, `Blues`, `Cividis`, `Earth`, `Electric`, `Greens`, `Greys`, `Hot`, `Jet`, `Picnic`, `Portland`, `Rainbow`, `RdBu`, `Reds`, `Viridis`, `YlGnBu`, `YlOrRd`. A `mode` or `colorscale` outside those lists is dropped on read (the key is absent and the model stays valid); any other bad value makes the model invalid. In the Plotly figure a line is mode `lines` and an area is a scatter with `fill: tozeroy`; heatmap, contour and surface take the trace colourscale, else the layout's, else `Viridis`, and show the colour bar; their z matrix has one row per table row and one column per `z` letter (transposed when `transpose` is true); text cells in a numeric column are drawn as gaps, except in the X column of a bar or box and the pie labels.
- A function is `{kind, rel?, expr, domain?, domain2?, steps?, color?, name?, hidden?}`: `kind` one of `y`, `x`, `param`, `polar`, `implicit`, `surface`, `param3d`, `curve3d`; `rel` one of `=`, `<`, `>`, `<=`, `>=`; `expr` a non-empty list of expressions, one per component, kept as written; `domain` and `domain2` ranges `[lo, hi]`; `steps` a positive integer or a pair of them. Sampled points are never stored.
- A variable is `{name, value, min?, max?, step?}`; `value`, the value last shown, is required.
- `layout` is `{xaxis, yaxis, zaxis?, legend, colorscale?, barmode?, fontSize?, width?, height?, camera?}`. `barmode` is `group` or `stack`; `fontSize` is a positive number. A chart with a surface, scatter3d or mesh3d trace draws its x, y and z axes (`zaxis`, else linear) and the camera in the Plotly 3D scene instead of the plane axes. An axis is `{title?, type, range?, ticks?, grid?}`, `type` `linear` or `log`, `ticks` the positive tick step, `grid` whether grid lines show. The legend is `{show, x?, y?, orientation?}`, `orientation` `v` or `h`. The camera is the 3D view last shown, `{eye, center?, up?}`, each `{x, y, z}` rounded to 4 decimals.
- A model with an unknown `v`, kind, trace type or function kind, a bad column letter, a bad `src`, a missing required field or a non-finite number is invalid. Optional fields are absent when unused, and unknown keys are dropped.

## Merge

Two versions of one item file merge item by item, three-way against the device's base. When merges run: [library-format.md](library-format.md#conflict-copies).

- Items match by id. An item new on one side is kept; one both sides added is kept once.
- An edit wins over an untouched side. A delete wins over an untouched side but loses to an edit on the other side.
- An item both sides edited merges per attribute (a conflicting attribute keeps the file's value), per cell result (the later `ran` wins) and per body line (an [inline result](#inline-results) span is part of its line, so two sides that changed it conflict as a line), with overlaps kept between `<<<<<<< local`, `=======` and `>>>>>>> <other>` lines. If the merged body would leave a fence open, both versions are kept as two items with the same id.
- Without a base the result is the union by id, and no delete is honoured. A base that shares no item with one side counts as no base.
- The merged file is read again. If it would not hold the merged ids in the merged order, the merge fails and both files stay.
- The base never takes a copy's text, because a copy may be this device's own version.

## Manuscript links

"Insert from note" puts an equation or an output of a note into a manuscript and records where it came from in a comment, so the manuscript can later be compared with the note.

```
\begin{equation}
E = mc^2
\label{eq-energy}
\end{equation} % labshelf: notes/physics.qmd#eq-energy @3f2a9c01b7de
```

- The origin comment is the last thing on the `\end{equation}` line: `% labshelf: <note path>#<label> @<hash>` in LaTeX, `// labshelf: …` in Typst. A comment that does not match (no `#label`, a hash that is not 12 lowercase hex characters, extra text after the hash) is ignored, and the equation is not tracked.
- The note path is the POSIX path relative to the project folder (`notes/physics.qmd`), or `paper:<paper id>/notes.qmd` for a cited paper's notes.
- The label is the equation's `{#eq-…}` label with its `eq-` prefix, or the `cell` label of the output.
- The hash is the first 12 lowercase hex characters of the SHA-256 of the trimmed LaTeX between `\begin{equation}` and `\label{…}`. In Typst it covers the text between the `$` pair.
- The inserted block runs from `\begin{equation}` to the end of the comment line.
- An origin is in one of five states, from the recorded hash, the manuscript's current hash and the note's current equation hash:
  - `fresh`: neither changed.
  - `stale`: the note changed, the manuscript did not.
  - `diverged`: the manuscript changed, the note did not.
  - `both`: both changed.
  - `missing`: the note or its label is gone.
- Update replaces the whole inserted block, comment included, with the note's current text, and only for `stale`. It never overwrites a manuscript edit: `diverged` and `both` are refused.
- The Typst insert is not offered until a LaTeX to Typst converter exists.
- The list offers the equations and outputs of the project's notes, then of the cited papers' notes. An output whose `source` is out of date ([Outputs](#outputs)) is listed but not insertable.
- The writing checklist lists `stale`, `diverged`, `both` and `missing` origins under References, not `fresh` ones.
