# Contract: Spaces

Read when you change Space storage or the page-to-host boundary.

A Space groups papers, writing projects, dates and a glossary around one piece of work. Every app reads and writes the same two files, and the user's sync tool moves them between devices, so changing a file name, a key or a rule here changes the contract for every app and for libraries already on disk.

## Layout

```
<library root>/
  spaces/
    <space id>/              one folder per Space; the folder name is the space id
      space.json             required: a folder holding it is a Space
      glossary.json          optional: a missing file is an empty glossary
```

Hidden entries in `spaces/` and folders without `space.json` are not Spaces.

## space.json

```json
{
  "version": 1,
  "name": "Research internship",
  "purpose": "…",
  "createdAt": "2026-10-20T10:00:00Z",
  "folders": [{ "id": "f1", "name": "Baselines", "parent": "f0" }],
  "papers": [{ "id": "<paper id>", "folder": "f1", "addedAt": "…", "focus": true }],
  "projects": ["<project id from labshelf.yaml>"],
  "dates": [
    { "id": "d1", "kind": "task", "title": "Rerun SAM", "date": "2026-10-22", "done": false },
    { "id": "d2", "kind": "read", "title": "Read the background papers", "date": "2026-11-03", "paperIds": ["…"] },
    { "id": "d3", "kind": "project", "title": "First draft", "date": "2026-11-10", "projectId": "…" },
    { "id": "d4", "kind": "deadline", "title": "Report due", "date": "2026-11-14" }
  ]
}
```

- `name` is what the user sees; `purpose` is optional free text.
- A folder without `parent`, and a paper reference without `folder`, sit at the Space root.
- `papers` references papers by paper id; the paper itself stays in `papers/`. `focus` is optional and means the paper is pinned to the Space overview.
- `projects` lists project ids ([library-format.md#layout](library-format.md#layout)), each at most once.
- A date `kind` is one of `task`, `read`, `project`, `deadline`. `done` belongs to `task`, `paperIds` to `read` and `projectId` to `project`.

## glossary.json

```json
{
  "version": 1,
  "terms": [
    { "id": "t1", "term": "Segment Anything", "symbol": "SAM", "definition": "…", "source": { "paperId": "…", "page": 4 } }
  ]
}
```

`symbol` and `source` are optional, and so is `source.page`.

## Ids

- The space id is a slug of the name: lowercase ASCII letters, digits and `-`, accents folded to their base letter, every other run of characters turned into one `-`, no `-` at either end, at most 48 characters. An empty slug is `space`. A slug that names an existing folder in `spaces/` gets `-2`, `-3`… The id never changes; renaming a Space changes `name` only.
- Folder, date and term ids are short random strings, unique within their file.
- Dates are `YYYY-MM-DD`. Times are ISO 8601 in UTC to the second (`2026-10-20T10:00:00Z`).

## Reading

For a valid Space id, filesystem read failures return the states below without throwing. Invalid ids are rejected before accessing the file system.

- A `space.json` that cannot be read or is not a JSON object gives an unreadable Space (`{ state: "unreadable", id, path, reason }`), which the apps list so the user can see it and fix it.
- A `glossary.json` that cannot be read or is not a JSON object reads as an empty glossary that is read-only, so a write never erases it.
- A missing or empty `name` reads as the space id. A missing array reads as empty, and a missing `done` as false.
- Invalid entries (wrong types, a missing id, an unknown date `kind`) are hidden from the user, logged once per read, and written back unchanged after the valid entries of their array, so an older app never erases what a newer one wrote.
- A known top-level key of the wrong type in either file (an array key that is not an array, a `version` that is not a number, a `name`, `purpose` or `createdAt` that is not a string) makes the Space read-only, and the apps say why.
- A paper id, folder id, date id or term id that appears more than once keeps its first entry.
- A date key that belongs to another `kind` (`done` on a deadline) is dropped, so changing a date's kind never revives a stale key.
- A `parent` or `folder` that names a missing folder reads as the Space root. Folders on a `parent` cycle read as root folders.
- A `version` above 1 is read but never written: the Space is read-only, and the apps say why.

## Writing

- Writes to one Space happen one at a time within an app.
- Every write is atomic (a temp file renamed into place) and re-reads the file just before writing, so a change made by another device in between keeps every field the write does not touch.
- Keys the app does not know, at the top level and inside entries, survive a write.
- Every app writes the same bytes: the key order shown above, unknown keys after the known ones, two-space indent, a final newline. Optional keys are omitted when unset.
- Deleting a Space moves its whole folder to the trash. Deleting a folder moves its paper references and child folders to its parent.

## Conflict copies

A conflict copy of `space.json` or `glossary.json` (names from [library-format.md#conflict-copies](library-format.md#conflict-copies)) directly inside `spaces/<space id>/` is shown to the user, who resolves it: keep mine (delete the copy) or keep the other (the copy replaces the original). Keep both is not offered, because a Space has exactly one of each file.

## Page hosting

The catalog and Space page share a transport. Each subscriber receives every host message; removing one subscriber leaves the others active. A mount subscribes before sending `ready` with `view: "catalog"` or `view: "space"` plus its id. The host sends the requested snapshot after `ready` and after changes. A Space page ignores snapshots for other ids. Mount disposers release subscriptions and modal controls.

The host validates page messages with the Spaces parser before acting. Mutations identify the Space by `id`; a date draft carries only fields for its `kind`. Export sends `exportIcs`; the host saves the generated calendar. Paper selection and opening are separate actions. Project links use the id from `labshelf.yaml`, resolved by the host on that device.

The host persists the Space's inner tab through `onTab` and supplies it when mounting again. A sidebar folder supplies `folder` when mounting the Space; without an explicit tab, this opens Papers at that folder. Read-only snapshots show their reason and disable mutations while preserving navigation and calendar export. Missing references remain visible with a removal action. Unreadable catalog entries show the relative contract path and reason.

Hosts load core tokens, base styles, Arc mark styles and page widget styles. The catalog also needs `spaces-catalog.css`; the Space page needs `spaces.css` and `spaces-overview.css`, exported by core. The Space stylesheet includes Papers, Glossary and the positioned tabs. The Research chat panel uses `research-chat.css`. Positioned controls remain focusable with `aria-disabled` and a tooltip naming the missing capability. Host theme mapping applies before these surfaces mount.
