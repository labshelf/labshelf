# Session 2 — Interactive demos on the real core UI

- **Goal:** visitors use the real LabShelf library UI and reader on the website, fed by the demo library, with no backend.
- **Starts from:** session 1 committed: `@labshelf/website` builds, `website/demo-library/` exists, and the architecture rule allows this.
- **Ends with:** `website/dist/demos/library.js` and `reader.js` mount into `[data-demo="library"]` and `[data-demo="reader"]` (A1–A3).
- **Owns:** `website/src/demos/`, `website/css/demos/`, `website/__tests__/` (if any).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | Library demo: in-page host over the demo library | behaviour | implementer (opus) | A2 on a test page | [ ] |
| 2.2 | Reader demo: real PDF in core's reader | behaviour | implementer (opus) | A3 on a test page | [ ] |
| 2.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

2.1 and 2.2 have disjoint files and run in parallel.

## 2.1 — Library demo

- **Goal:** `website/src/demos/library.ts` finds `[data-demo="library"]` and mounts `mountLibraryUi` there, with a loopback transport. An in-page host answers the library-ui-host messages from an in-memory copy of the demo library. Status, tag and note edits change only memory and reset on reload.
- **Read only:**
  - `documents/contracts/library-ui-host.md`, Startup and the message tables;
  - `packages/core/src/library-ui/dom/mountLibraryUi.ts:19-50`;
  - `scripts/verify-library/mountFixture.ts:40-60`, the working loopback host with fake data;
  - `packages/browser/src/library-page/main.ts:21-45` and `library-page/host/hostController.ts`, the real host, to see which messages need answers;
  - `website/demo-library/`.
- **Decided:**
  - Build the snapshot at build time: a small build step in `website/build/` reads `website/demo-library/` into `website/dist/demos/library-data.json`. Session 1 owns `website/build/`, so add the step there through a new file `website/build/demoData.mjs` that this package owns.
  - Write the host in `website/src/demos/library/` as one file per concern, each at most 200 lines.
  - Unsupported actions (open PDF, sync, add) answer with a core toast that says "Available in the app".
  - Styles: core tokens CSS plus the VS Code Dark Modern `--vscode-*` block from the webview harness (`documents/apps/vscode.md` "Webview harness"), scoped to the demo container in `website/css/demos/library.css`.
- **Done when:**
  - A dev page `website/src/demos/dev.html`, served statically after a build, shows the list, the folders and the detail pane.
  - Search `status:reading` filters, a status click cycles, and the console is clean.
  - A test pins the in-page host's answers to `ready`, `paper.details` and the status change.
- **Do not touch:** `packages/`, `website/index.html`.

## 2.2 — Reader demo

- **Goal:** `website/src/demos/reader.ts` finds `[data-demo="reader"]`, builds the reader shell DOM there and runs `startReader` with an in-page transport on the demo library's committed PDF. Highlights stay in memory. "Copy with citation" writes to the clipboard.
- **Read only:**
  - `documents/contracts/reader-host.md`, Startup and Rules;
  - `packages/core/src/reader/dom/reader.ts:46`;
  - `packages/browser/src/reader/index.ts`, `inPageTransport.ts:1-30` and `reader/index.html`, the in-page precedent and the shell ids;
  - `packages/browser/build/vendorReader.mjs`, for the asset URLs;
  - `website/demo-library/LICENSES.md`, which names the PDF.
- **Decided:**
  - The PDF and the pdf.js assets are served from `website/dist/`.
  - The host answers `ready-for-init` with `init`, and persists annotations to memory only.
  - Styles live in `website/css/demos/reader.css`, scoped to the container.
  - The reader opens at a page with a highlight already made, so the visitor sees one at once.
- **Done when:** on `dev.html`, the PDF renders, selecting text shows the five colour buttons and Copy with citation, and a highlight appears in the sidebar. The console is clean.
- **Do not touch:** `packages/`, `website/index.html`.
