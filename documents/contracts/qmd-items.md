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

`anchor` says what an item is attached to: nothing, a highlight of the paper (`hl:<annotation id>` in the paper's `data.json`, [library-format.md](library-format.md#sidecar-datajson)), a text box on a PDF page (`p<page> box <x> <y> <w> <h>`, fractions of the page from the top-left, like highlights) or a passage of a project text file (`quote:<base64url>` of the JSON `{quote, prefix, suffix}`, the rules of a comment anchor in [library-format.md](library-format.md#project-folder-labshelf)).

An anchor in no known form, or one that breaks its rules, is kept verbatim and the item is shown as not attached.

## Outputs

A code cell's result follows the cell inside the same item, as a fenced div with the class `labshelf-output` and the attributes `cell`, `source`, `engine` and `ran`. Results travel inside the file, so a reader sees them without running anything.

- `cell` is the cell's `#| label:`. A cell with a result has a label.
- `source` is the first 12 hex characters of the SHA-256 of the cell's code with the `#|` lines removed, lines joined with `\n` and trailing line endings removed. Every device must compute it the same way, and line endings must never make a result out of date.
- A result whose `source` differs from its cell's current code is shown as out of date. A result whose cell is gone, or that lacks `cell` or `source`, is shown as text.
- A result that would close its block early is rejected, not written.

## Merge

Two versions of one item file merge item by item, three-way against the device's base. When merges run: [library-format.md](library-format.md#conflict-copies).

- Items match by id. An item new on one side is kept; one both sides added is kept once.
- An edit wins over an untouched side. A delete wins over an untouched side but loses to an edit on the other side.
- An item both sides edited merges per attribute (a conflicting attribute keeps the file's value), per cell result (the later `ran` wins) and per body line, with overlaps kept between `<<<<<<< local`, `=======` and `>>>>>>> <other>` lines. If the merged body would leave a fence open, both versions are kept as two items with the same id.
- Without a base the result is the union by id, and no delete is honoured. A base that shares no item with one side counts as no base.
- The merged file is read again. If it would not hold the merged ids in the merged order, the merge fails and both files stay.
- The base never takes a copy's text, because a copy may be this device's own version.
