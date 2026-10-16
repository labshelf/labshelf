# Contract: labshelf: links

Read when you change how a link to a paper is written, found or opened.

A `labshelf:` link points at a paper, and optionally at one of its pages, from any text file: a code comment, a draft, a README. Users write these links into files LabShelf does not own, so the grammar cannot change without breaking links already on disk. Core's `library/links` module is the one parser; every app uses it.

## Grammar

```
labshelf:<cite key>[#p<page>]
web+labshelf:<cite key>[#p<page>]
```

- The cite key is one or more of `A–Z a–z 0–9 _ : . -` and matches a paper's cite key case-sensitively. When two papers share a key, the paper with the smallest id wins, as in every citation lookup.
- The page is a 1-based integer. A link without a page opens the paper at its saved reading position.
- In free text, a link is not preceded by a letter, digit, `_` or `+`. When the link has no page, trailing `.`, `:` and `-` belong to the sentence and are not part of the key.
- `web+labshelf:` is the same link in the form browsers can register; apps accept both and write `labshelf:`. A whole link may arrive percent-encoded once, as a browser protocol handler passes it.

## Opening a link

| App | Entry | Behaviour |
|---|---|---|
| VS Code | a link in any file; `vscode://<extension id>/open?link=<percent-encoded link>` | opens the reader at the page; hover shows the title |
| Terminal | `labshelf open <link>` | opens the PDF in the configured viewer, passing the page where the viewer accepts it |
| Browser | `web+labshelf:` links on any web page | opens the extension's reader at the page |

A key that matches no paper opens nothing and tells the user which key was missing.
