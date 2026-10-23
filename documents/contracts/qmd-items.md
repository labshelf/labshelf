# Contract: qmd item files

Read when you change how LabShelf reads or writes a `.qmd` file of notes, comments or discussion messages.

Every place a user writes outside LaTeX or Typst is a `.qmd` item file: one file per case (all notes of a paper, one discussion thread), holding one item per note, comment or message. The files sit in libraries, projects and Spaces that sync tools and other people's apps change, and users open them in Quarto or any text editor, so the format cannot change without breaking files already on disk. Core's `qmd` domain is the one parser and writer; every app uses it.

## Format

An item file is UTF-8 text in "LabShelf Markdown", a subset of [Quarto Markdown](https://quarto.org/docs/authoring/markdown-basics.html). LabShelf shows and edits these constructs:

| Construct | Written as |
|---|---|
| Paragraph | text with `*emphasis*`, `**strong**` and `` `inline code` `` |
| Heading | ATX, `#` to `######` |
| List | bullet (`-`) or ordered (`1.`) |
| Task list | `- [ ] open task`, `- [x] done task` |
| Inline math | `$…$` |
| Display math | `$$…$$`, optionally followed by ` {#eq-<label>}` |
| Code cell | ```` ```{python} ```` … ```` ``` ````; its first lines may be `#|` options such as `#| label: <label>`, kept verbatim |
| Cell result | an output block, see [Outputs](#outputs) |
| Image | `![alt](path)` |
| Paper link | `[text](labshelf:…)`, grammar in [links.md](links.md#grammar) |
| Citation | `[@key]`, `[@a; @b]` |

Any other Markdown (tables, block quotes, callouts, raw HTML, YAML front matter) is kept byte for byte as a raw block: shown as source, written back unchanged, never dropped.

- Line endings are whatever the file uses. LabShelf writes new lines with the line ending of the file's first line, and `\n` in a file without one.
- A file that LabShelf reads and writes back without an edit is byte-identical, including its line endings, a missing final newline and a leading byte order mark.
- A code fence is three or more `` ` `` or `~`, indented at most three spaces, followed by nothing, by one word, by an attribute block `{…}`, or by one word and an attribute block, as in Pandoc. It counts only when a closing fence of the same character, at least as long, follows it; until then it is ordinary text.

## Items

An item is a fenced div at the top level of the file, outside any code fence, whose opening line carries the class `labshelf-item` and an id:

```
::: {#n-01JB2Q8Z5K7M3V9X4C6T8R2W0Y .labshelf-item anchor="p10 box 0.12 0.4 0.3 0.1" author="Ana" created="2026-10-22T09:12:00.000Z"}
The bound is tight when $\epsilon \to 0$.
:::
```

- The opening line is `:::` (three or more colons), optional spaces, and one attribute block `{…}`, optionally followed by colons. The block holds `#<id>`, `.<class>` and `<key>="<value>"`, `<key>='<value>'` or `<key>=<value>` entries separated by spaces. Inside a quoted value, `\"`, `\'` and `\\` stand for `"`, `'` and `\`, and every other backslash is itself; values never span lines. HTML entities in values and an `id=` key are not read as Pandoc reads them, so a fence that relies on them is loose text.
- A div opens on a line of three or more colons followed by an attribute block or one word, at the start of the file or body or after an empty line, a heading, a div fence or a closing code fence. As in Pandoc, an opening line right after paragraph text is text.
- The item ends at the first line that is only colons (three or more) and optional spaces, at the same nesting depth: nested divs open and close inside it, and lines inside code fences do not count. A fenced div at the top level that is not an item is loose text as a whole, and items inside it are not items.
- The item's body is every byte between its opening and closing lines. Its content is LabShelf Markdown.
- Attributes:
  - `#<id>`: required; the item's identity, see [Ids](#ids). Ids are unique in a file. When a hand edit repeats an id, every item with it is still shown and kept.
  - `anchor`: optional; what the item is attached to, see [Anchors](#anchors).
  - `author`: optional; the display name of the person who wrote the item.
  - `created`: optional; ISO-8601 UTC timestamp of when the item was written.
  - Any other class or attribute is kept, in its order, when LabShelf rewrites the item.
- LabShelf writes a new item's opening line in this order: `#id`, `.labshelf-item`, `anchor`, `author`, `created`, then further attributes; an attribute with an absent or empty value is left out. Values are written in double quotes.
- An item is written as its opening line, its body (ending with a line ending), and a closing line `:::`. A new item goes at the end of the file, after one empty line; when the file lacks a final line ending, one is added first. Removing an item also removes one empty line next to it. Any other edit changes only the bytes of the item it edits.
- A body that LabShelf writes never changes how the rest of the file reads: every nested div it opens is closed inside it, it holds no closing line of its own, and every code fence it opens is closed inside it. LabShelf reads the file again before writing and rejects, without writing, an edit after which any other part reads differently.

### Text outside items

Anything that is not an item is loose text: YAML front matter, text a user typed between items, a fenced div without `labshelf-item` or without an id, and a fence that does not parse.

- Loose text is kept byte for byte, in place.
- Loose text that holds more than whitespace is shown in its place as a note without an anchor.
- An opening line whose div is never closed is an ordinary line of loose text, and reading goes on after it: the items that follow are still items. This differs from Pandoc, which closes the div at the end of the file, on purpose: one broken item never hides the rest. The broken item's text shows as a note without an anchor until its closing line is restored.

## Ids

An item id is `n-` followed by a [ULID](https://github.com/ulid/spec): 26 characters of Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), the first 10 encoding the creation time in milliseconds since the Unix epoch and the last 16 encoding 80 random bits.

- Any device creates ids without coordination; ids sort by creation time.
- Ids that one device creates within the same millisecond increase: the random part of the previous id plus one.
- An id is never reused and never changes, also when the item moves or its anchor changes.
- LabShelf reads items with any non-empty id, so hand-written ids work; it creates only ids of this form.

## Anchors

The `anchor` attribute says what an item is attached to. LabShelf writes these forms:

| Anchor | Meaning |
|---|---|
| absent or empty | not attached |
| `hl:<annotation id>` | a highlight of the paper, by its id in `data.json` ([library-format.md](library-format.md)) |
| `p<page> box <x> <y> <w> <h>` | a text box on a PDF page |
| `quote:<base64url>` | a passage of a project text file |

- A text box: `page` is a 1-based integer; `x`, `y`, `w`, `h` are fractions of the page width and height measured from the top-left corner, as for highlights. Each is a decimal between 0 and 1 with at most 4 digits after the point; `w` and `h` are greater than 0, `x + w` and `y + h` at most 1. Tokens are separated by single spaces.
- A passage: the value is the unpadded base64url of the UTF-8 JSON object `{"quote": …, "prefix": …, "suffix": …}`, with the same fields and rules as a comment anchor in [library-format.md](library-format.md#labshelfcommentsjson): `quote` non-empty, `prefix` and `suffix` up to 32 characters around it. Other keys in the object are ignored.
- An anchor in no form above, or a box or passage that breaks its rules, is kept verbatim and the item is shown as not attached.

## Outputs

A code cell's result follows the cell, inside the same item, as a fenced div with the class `labshelf-output`:

````
```{python}
#| label: bound
import sympy as sp
x = sp.symbols("x")
sp.integrate(sp.exp(-x**2), (x, -sp.oo, sp.oo))
```

::: {.labshelf-output cell="bound" source="3f9a1c0b7d2e" engine="python-3.12 sympy-1.13" ran="2026-10-22T09:15:03.000Z"}
$$\sqrt{\pi}$$
:::
````

- `cell`: the `#| label:` of the cell the result belongs to. A cell with a result has a label.
- `source`: the first 12 lowercase hex characters of the SHA-256 of the cell's code. The code is the text between the cell's fences, split into lines at `\r\n`, `\n` or `\r`, without the lines that start with `#|`, joined with `\n`, with trailing line endings removed, encoded as UTF-8. Line endings therefore never make a result out of date.
- `engine`: the runtime and libraries that produced the result, as `<name>-<version>` words separated by spaces, for example `python-3.12 sympy-1.13`.
- `ran`: ISO-8601 UTC timestamp of the run.
- The content is LabShelf Markdown: text, math and images. It follows the rule of an item body: a result that would close the block early is rejected, not written.
- A result whose `source` differs from the hash of its cell's current code is shown as out of date. A result whose cell is gone, or that lacks `cell` or `source`, is shown as text.
- Results travel inside the file, so a reader sees them without running anything.

## Merge

How two devices' edits of one item file are combined: [sync.md](sync.md#conflict-copies).
