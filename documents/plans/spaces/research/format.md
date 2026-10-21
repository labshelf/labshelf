sha: (plan draft, 2026-10-20)
files: documents/contracts/library-format.md
source: plan decisions D2–D5, D8

# Space file format (decided)

- A Space is `spaces/<space id>/space.json` and `spaces/<space id>/glossary.json` under the library root. `spaces/` is a sibling of `papers/` and `projects/`.
- The space id is a slug of the name (lowercase ASCII letters, digits and `-`, at most 48 characters, never empty: `space` if the slug is), made unique with `-2`, `-3`… against existing folders. It never changes; renaming changes `name` only.
- `space.json`:
  ```json
  { "version": 1, "name": "Research internship", "purpose": "…", "createdAt": "2026-10-20T10:00:00Z",
    "folders": [{ "id": "f1", "name": "Baselines", "parent": "f0" }],
    "papers": [{ "id": "<paper id>", "folder": "f1", "addedAt": "…", "focus": true }],
    "projects": ["<project id from labshelf.yaml>"],
    "dates": [{ "id": "d1", "kind": "task", "title": "Rerun SAM", "date": "2026-10-22", "done": false },
              { "id": "d2", "kind": "read", "title": "Read the background papers", "date": "2026-11-03", "paperIds": ["…"] },
              { "id": "d3", "kind": "project", "title": "First draft", "date": "2026-11-10", "projectId": "…" },
              { "id": "d4", "kind": "deadline", "title": "Report due", "date": "2026-11-14" }] }
  ```
- `glossary.json`: `{ "version": 1, "terms": [{ "id", "term", "symbol"?, "definition", "source"?: { "paperId", "page"? } }] }`.
- Ids inside a file (`f…`, `d…`, term ids) are random, short and unique within the file. Dates are `YYYY-MM-DD`; times are ISO 8601 UTC.
- A paper id appears at most once in `papers`. A folder `parent` and a reference `folder` that name a missing folder read as the Space root. A cycle in `parent` reads as root for the folders on the cycle.
- Unknown keys, at the top level and inside entries, survive a write. A version above 1 is read but never written: the Space is read-only and says why.
- Reading never throws. An unreadable `space.json` gives `{ state: "unreadable", id, path, reason }`. Invalid entries are dropped on read and logged once.
- Writes are atomic through `LibraryFileSystem.writeText`. Delete Space uses `trash` on the whole folder.
- A conflict copy of `space.json` or `glossary.json` (names from `library-format.md#conflict-copies`) is listed for the user with keep mine / keep the other; keep both is not offered, because a Space has exactly one of each.
