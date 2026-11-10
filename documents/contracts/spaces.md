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
  notes/assets/<id>.csv              optional: the data of a chart in a note, see below
```

Hidden entries in `spaces/` and folders without `space.json` are not Spaces.

`space.json` holds folders, paper references, project ids, dates and the [desk](#desk). Papers are referenced by paper id and projects by project id ([library-format.md](library-format.md#labshelfyaml)); the paper or project stays where it is. `glossary.json` holds terms with an optional symbol and source paper.

`space.json` may hold an optional top-level `icon`, the name of an icon of the Tabler library LabShelf ships (`packages/core/src/ui/icons/tabler/`). The Space shows it on its catalog card, its sidebar row and its page header in place of the layers icon. Changing the icon writes the key, and choosing Default removes it. An unknown name or a value of the wrong type is ignored on read and dropped on the next write; it never makes the Space read-only.

A Space sits in one of three places, set by two optional top-level keys of `space.json`, written after `createdAt`:

- `archived`: written only as `true`, absent otherwise. The Space is listed under Archived.
- `trashedAt`: the ISO time the Space was moved to Trash, absent otherwise. The Space is listed under Trash, whatever `archived` says.

Moving to Trash keeps `archived`, so Restore (removing `trashedAt`) returns the Space to Archived if it was archived. Neither key moves the folder; only Delete forever (one Space, or Empty Trash for every readable Space in Trash) moves `spaces/<id>/` to the system trash. A value of the wrong type is ignored on read, so the Space stays in Spaces and writable. The sidebar lists only Spaces in the Spaces place, plus unreadable ones.

## Desk

The desk is what the user pins to the top of the Space Overview: at most 3 items of any kind. `desk` is an optional top-level array of `space.json`, written after `dates`, of entries `{ "kind": …, "ref": … }`:

| `kind` | `ref` |
| --- | --- |
| `paper` | a paper id; the paper need not be in the Space's `papers` |
| `note` | a path `notes/<name>.qmd` |
| `thread` | a path `discussions/<name>.qmd` |
| `project` | a project id; the project need not be linked |

- Order is the order on the desk. Pinning appends, and pinning when the desk already holds 3 entries is refused. A file another device wrote may hold more; the desk shows the first 3 and a write keeps them all.
- A repeated `kind` and `ref` keeps its first entry. An entry with an unknown `kind` or a `ref` that is not text is kept unread and written back after the valid ones. A `desk` that is not an array makes the Space read-only.
- An entry whose paper, note, topic or project is gone stays on the desk as missing until it is unpinned.
- A Space without `desk` shows the papers whose reference has `focus: true`, at most 3, in `papers` order. The first pin or unpin writes `desk`, starting from those papers; `focus` is written back unchanged and is not read while `desk` exists.

## Notes and discussions

The `.qmd` files of a Space are item files ([qmd-items.md](qmd-items.md#items)). A folder is created on the first write, and a missing folder lists as empty. A file path is relative to the Space folder and is `notes/<name>.qmd` or `discussions/<name>.qmd`, with one visible name (no slash, no leading dot). No other path is read or written.

- A note is titled by the first `# ` heading of its first item, else the file name without `.qmd`. The slug is made as for [project notes](qmd-items.md#project-notes), and the first item of a new note has the body `# <title>`.
- A thread is a topic item, then one item per message in file order. The topic body is `# <title>`, a blank line and the text, and its attribute `status` is `open` or `resolved`. A topic without `status`, or with another value, reads as open. Changing the status rewrites only that value.
- A message is one item with the `author` and `created` of the writer. Only its author edits or deletes it, on a writable Space, and never the topic item that way. An edit from the page sets the item attribute `edited` to the ISO time of the edit (`editSpaceItem`; `discussions.editMessage` takes it as `{ edited }`), and the message shows "(edited)" with that time as its title. A cell's output write never sets `edited`. A delete (`removeSpaceItem`) is confirmed first, and records made from the message (saves, agreements, tasks, meetings) stay as they are.
- Any member renames a topic on a writable Space with "Rename topic…" in its More menu: `editSpaceItem` on the topic item, with the body `# <new title>` and the rest of the old text, and `status` unchanged. The Space chat has no rename.
- An open conversation reads its file again (`readSpaceQmd`) when its list entry (`messages`, `updated` or `last`) differs from what it shows, at most one read at a time. It is marked seen once its messages are on screen.
- "Send to…" ([qmd-items.md](qmd-items.md#project-notes)) has the targets `spaceNote` and `discussion`, which append an item or a message with the id of the sent item. A figure's PNG is written first, as `assets/<item id>.png` next to the target file.
- A chart in a note whose table is over 64 KB keeps it in `notes/assets/<id>.csv` ([qmd-items.md](qmd-items.md#charts)). The page reads, writes and picks that file through `space.noteFile` (`noteFile.read`, `noteFile.write`, `noteFile.pick`), only for paths under `assets/` beside the note, and the host answers with `noteFile.reply`. `serveSpaces` calls the optional `noteFiles(spaceId, notePath, request)` option and posts its reply, or an error reply without it.

- The Space chat is `discussions/_chat.qmd`. No topic slug can take that name. It has no topic item: every item is a message. It lists with the title "Space chat", always open, and its message count is its item count. The first message sent to it creates the file.
- Search reads the bodies of every thread file and the chat, plus each topic's title, case-insensitively, and returns at most 50 hits in file order.
- Under the Space chat, the Discussions list the Project chat of each shared project the Space links (`SpaceProjectEntry.hasChat`), in the Space's order. It reads and writes the project's own `<project>/.labshelf/chat.qmd` ([qmd-items.md](qmd-items.md#project-chat)), never a copy in the Space. The page posts `openProjectChat` with the project id (null to close) before its `projectChat.*` messages, and `serveSpaces` serves one such chat at a time over the Space channel with the options of the optional host method `projectChat(projectId)`, only for a project linked to the open Space; a project the host cannot serve gets `projectChat.error`.

An edit or removal of an id the file does not hold writes nothing and reports an error. The author of an added item or a new thread is the app's author name; `serveSpaces` takes it as `author`, a string or a getter read on every use. The internal page/host protocol is defined by the types and parser in `packages/core/src/spaces/spacesProtocol.ts`.

The host lists each conversation as a `SpaceThreadEntry`: `path`, `title`, `status`, `messages` (the items after the topic; every item of the Space chat), `updated`, `last` (the file's last item as `{ body, author?, created? }`, its body cut to 2000 characters) and `unread`. `unread` counts, for the app's author, the messages by others created after that author's `seen` entry of the conversation, or every message by others without one. Previews of a message show its inline and display math as `[equation]`.

## Discussion records

A message can be turned into something the Space keeps. Each record names its message by the conversation file and the item id, `{ "path": "discussions/<name>.qmd", "itemId": … }`. `by` is the app's author name, and `created` is an ISO time. The app stamps both.

- `saved`: an optional top-level array of `space.json`, written after `desk`, with entries `{ "id", "path", "itemId", "by", "created" }`. It holds one member's bookmark of a message. Saving a message that member already saved removes the entry.
- `agreements`: an optional top-level array, written after `saved`, with entries `{ "id", "text", "path", "itemId", "by", "created" }`. Editing an agreement changes only `text`.
- `seen`: an optional top-level array, written after `agreements`, with entries `{ "id", "path", "by", "at" }`: when `by` last opened the conversation at `path` (an ISO time). There is one entry per person and conversation, and its id is derived from `by` and `path` (`seen:<by, URI-encoded>:<path>`), so every copy of a shared Space names it alike. The page asks for it when a conversation opens and while new messages arrive in it, at most every 2 seconds and never on a read-only Space; the app stamps `by` and `at`, and an entry with a later `at` is kept.
- A `task` date may hold `assignee` (text) and `source` (a message reference).
- A `meeting` date has `title` and `date`, and may hold `start` and `end` (`HH:MM` local time, `end` after `start`), `participants` (a list of names), `agenda` (text) and `source`. A meeting without `start` lasts the whole day. The .ics export writes the meeting with its times (floating local time) and its agenda as the description.

A file without `saved`, `agreements` or `seen` reads and writes back without them. An entry without a text id, without a message reference (a `path` for `seen`), or with `by`, `created`, `at` or `text` that is not text is kept unread and written back after the valid ones. A `saved`, `agreements` or `seen` value that is not an array makes the Space read-only. A share merges the three arrays by entry `id`, like `dates` ([collaboration.md](collaboration.md#space-shares)).

## Sharing

A Space is shared live with its notes, threads, papers, glossary, dates and projects ([collaboration.md](collaboration.md#space-shares)). `space.json` then holds the optional top-level `shared`, the share id, written after `trashedAt` and per user like `desk`, `icon`, `archived`, `trashedAt` and `projects`. A value of the wrong type is ignored on read and dropped on the next write. Joining a Space creates `spaces/<id>/` with an id derived from the shared name, and leaving removes `shared` and keeps every file.

A paper reference may hold `info` (title, authors, year, DOI, URL and the PDF's SHA-256 and size), which a member holding the paper writes so members without it can see and download it ([Space papers](collaboration.md#space-papers)). It is kept as it is on read and write.

Members of a shared Space see who else is online in Discussions: the header lists them by name once each, however many devices they use, with their colour (at most four, then `+N`), and a conversation row shows a dot when a member has it open. In the open conversation a line under the messages says who is typing there (`Ana is typing…`, `Ana and Bruno are typing…`, `Several people are typing…`). The page sends the conversation it has open and typing while the composer has text, at most every 2 s, and stops typing 4 s after the last keystroke, after a send or when the composer empties; it clears the conversation when it leaves the Space. A read-only Space never reports typing. This travels only in share presence (the `conversation` field of [awareness](collaboration.md#messages)) and is never written to the Space's files. A host without presence shows none of it.

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
