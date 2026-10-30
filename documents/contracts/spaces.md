# Contract: Spaces

Read when you change Space storage.

A Space groups references to papers and writing projects, dates, a glossary, notes and discussion threads. Hosts use the same file formats, and a sync tool can move these files between devices. This contract defines their persistent layout; the product role of a Space is in [product.md](../product.md#spaces).

## Layout

```
<library root>/spaces/<space id>/    the folder name is the space id
  space.json                         required: a folder holding it is a Space
  glossary.json                      optional: a missing file is an empty glossary
  notes/<slug>.qmd                   optional: one file per note
  discussions/<slug>.qmd             optional: one file per thread
```

Hidden entries in `spaces/` and folders without `space.json` are not Spaces.

`space.json` holds folders, paper references, project ids and dates. Papers are referenced by paper id and projects by project id ([library-format.md](library-format.md#labshelfyaml)); the paper or project stays where it is. `glossary.json` holds terms with an optional symbol and source paper.

## Notes and discussions

The `.qmd` files of a Space are item files ([qmd-items.md](qmd-items.md#items)). A folder is created on the first write, and a missing folder lists as empty. A file path is relative to the Space folder and is `notes/<name>.qmd` or `discussions/<name>.qmd`, with one visible name (no slash, no leading dot). No other path is read or written.

- A note is titled by the first `# ` heading of its first item, else the file name without `.qmd`. The slug is made as for [project notes](qmd-items.md#project-notes), and the first item of a new note has the body `# <title>`.
- A thread is a topic item, then one item per message in file order. The topic body is `# <title>`, a blank line and the text, and its attribute `status` is `open` or `resolved`. A topic without `status`, or with another value, reads as open. Changing the status rewrites only that value.
- A message is one item with the `author` and `created` of the writer.
- "Send to…" ([qmd-items.md](qmd-items.md#project-notes)) has the targets `spaceNote` and `discussion`, which append an item or a message with the id of the sent item. A figure's PNG is written first, as `assets/<item id>.png` next to the target file.
- Spaces are not shared: the files stay in the library and notes and threads show only in the local UI.

An edit or removal of an id the file does not hold writes nothing and reports an error. The author of an added item or a new thread is the app's author name. The internal page/host protocol is defined by the types and parser in `packages/core/src/spaces/spacesProtocol.ts`.

## Ids

The space id is a slug of the name, made once. It never changes: renaming a Space changes `name` only. Folder, date and term ids are short random strings. Dates are `YYYY-MM-DD` and times ISO 8601 in UTC.

## Reading and writing

Another device, or a newer app version, may have written anything. Reading never throws, and nothing it does not understand is erased.

- A `space.json` that cannot be read or is not a JSON object is listed as an unreadable Space so the user can see it. An unreadable `glossary.json` reads as an empty glossary that is read-only, so a write never erases it.
- Invalid entries are hidden, logged once per read, and written back unchanged after the valid entries of their array, so an older app never erases what a newer one wrote.
- A known top-level key of the wrong type, or a `version` newer than the app knows, makes the Space read-only and the apps say why. A newer `version` is read but never written.
- A repeated id keeps its first entry. A `parent` or `folder` naming a missing folder reads as the Space root, and a `parent` cycle reads as root folders. A date key that belongs to another `kind` is dropped.
- Writes to one Space happen one at a time within an app. The [file rules](../code.md#files) apply, with the key order of the model and unknown keys after the known ones.

## Conflict copies

A conflict copy of a `.qmd` file inside `spaces/<space id>/` is merged without asking, item by item ([qmd-items.md](qmd-items.md#merge)); a failed merge goes to the user.

A conflict copy of `space.json` or `glossary.json` ([names](library-format.md#conflict-copies)) goes to the user, who keeps mine or keeps the other. Keep both is not offered, because a Space has exactly one of each file.
