# Contract: labshelf: links

Read when you change how a link to a paper is written, found or opened.

A `labshelf:` link points at a paper, and optionally at one of its pages, from any text file: a code comment, a draft, a README. Users write these links into files LabShelf does not own, so the grammar cannot change without breaking links already on disk. Every app parses it the same way.

## Grammar

```
labshelf:<cite key>[#p<page>]
web+labshelf:<cite key>[#p<page>]
```

- The cite key is one or more of `A–Z a–z 0–9 _ : . -` and matches a paper's cite key case-sensitively. When two papers share a key, the smallest id wins, as in every citation lookup.
- The page is a 1-based integer. A link without a page opens the paper at its saved reading position.
- In free text, a link is not preceded by a letter, digit, `_` or `+`. Without a page, trailing `.`, `:` and `-` belong to the sentence, not the key.
- `web+labshelf:` is the same link in the form browsers can register. Apps accept both and write `labshelf:`. A whole link may arrive percent-encoded once, as a browser protocol handler passes it.
- A key that matches no paper opens nothing and tells the user which key was missing.
