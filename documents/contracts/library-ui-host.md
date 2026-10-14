# Contract: library UI and its hosts

The library UI (folder header, filter bar, paper list, paper menu, detail pane) is one UI in core that a host mounts once. The host owns the library data, every mutation, files, the clipboard and the reader. The UI owns everything on screen, including every dialog, menu, picker and prompt, and builds every text it shows or copies (citations, BibTeX, annotation Markdown) from the records. They talk only through the typed message unions in core's `library-ui/protocol` module, which is the single source of truth for message shapes. Every payload is plain JSON: arrays, never Sets.

Two hosts mount it:

- **VS Code** runs it in the list webview and answers over `postMessage`. The webview is untrusted: the extension host passes every message through `parseUiMessage` and drops what fails it. Prefs live in the webview state.
- **The browser library page** runs it in the page and answers over an in-page loopback channel. Its own glue sits around the mounted UI: the folder tree in the sidebar slot, the URL hash and the sync status bar. Prefs live in localStorage under `labshelf.library.prefs`, together with the tree's expanded folders.

## Paths

The UI names folders and papers by "/"-separated paths that start at `papers` (the library root). A host whose files live elsewhere maps them both ways and never shows the UI an absolute path. A path the host receives must be `papers` or below it, with no empty, `.` or `..` segment.

## Startup

1. The host starts listening on its end of the channel, then calls `mountLibraryUi(element, { transport, prefs, capabilities, labels, withSidebar })`. `prefs` is a `PrefsPort` over the host's storage. The UI starts empty and shows "Loading…".
2. The UI sends `ready`.
3. The host answers with `navigate` to the folder it wants open and then `snapshot`: the folder tree, every paper record, the record paths that have a PDF on this device, and reading stats by paper id (annotation count, last page, last read).
4. The host may send `select` for a paper to show first, and `jobs` with the OCR running.

## Capabilities and labels

Shared actions (open, status, move, remove, copy, folders, tags and keywords as searches, Related without similar content) work on every host. Everything else is a capability the host declares at mount; a capability left out hides every control that would send its message:

| Capability | Host answers | VS Code | Browser |
|---|---|---|---|
| `paperData` | `paper.details`; sends `sidecarChanged`; its stats fill Last read and the row marks | yes | no |
| `editTags` | `paper.setTags` | yes | no |
| `editNote` | `paper.setNote` | yes | no |
| `textLayer` | `paper.makeSearchable`; sends `jobs`; the UI shows the No text filter and banners | yes | no |
| `similar` | `paper.similar` | yes | no |
| `reveal`, `openExternal`, `fetchMetadata`, `exportAnnotations` | the message of the same name | yes | no |
| `findPdf`, `attachPdf` | `paper.findPdf`, `paper.attachPdf` | no | yes |

Labels are the few texts that name a host's own way of working: the Add button's tooltip, the empty folder's hint, and the name of the reveal action.

## Messages

UI to host:

| Message | Sent when | Host answers |
|---|---|---|
| `ready` | the UI is mounted | `navigate`, `snapshot`, optionally `select` and `jobs` |
| `navigate` | the user opened another folder | nothing; the host keeps the folder for later replies |
| `folder.create`, `folder.rename`, `folder.delete` | the user confirmed the prompt | `snapshot`, then `navigate` when the open folder moved or was deleted |
| `paper.open` | Enter, double-click, Open PDF, an annotation (with its `page`) | opens the reader, or `pdf.missing` when the paper has no readable PDF |
| `paper.details` | a paper is shown in the detail pane | `details` |
| `paper.similar` | the Related tab is shown | `similar` |
| `paper.setStatus` | badge click, status segment, menu, Alt+1 to Alt+3 | `snapshot`; a `notice` for papers that failed |
| `paper.setTags` | a tag added or removed in the detail pane | `snapshot`; a `notice` for papers that failed |
| `paper.setNote` | the note was typed and paused, or left | `snapshot` |
| `paper.move` | drop on a folder, Move to | `snapshot` and a `notice` |
| `paper.remove` | the user confirmed Remove | moves the folders to the trash; `snapshot` and a `notice` |
| `paper.makeSearchable` | Make searchable | `jobs` while OCR runs, then `snapshot` |
| `paper.openExternal`, `paper.reveal`, `paper.fetchMetadata`, `annotations.export` | the menu or the detail pane | does it |
| `paper.findPdf` | Find PDF | `pdf.busy`, `progress`, then `snapshot` with a `notice`, or `pdf.findResult` when nothing was found |
| `paper.attachPdf` | Attach PDF | opens a file picker in the same call; `snapshot` and a `notice` once a file is attached |
| `paper.add` | Add | `add.sources`, or opens the host's own import, or a `notice` when there is nothing to add from |
| `paper.addFrom` | the user picked a source, or answered the "No PDF found" dialog | `progress`, then `snapshot`, `select` and a `notice`, or `add.noPdf` |
| `clipboard.write` | any copy; `label` names what was copied | a `notice` |

Host to UI:

| Message | UI does |
|---|---|
| `snapshot` | replaces the library; records and stats equal to the ones it holds keep their identity, so unchanged rows keep their DOM nodes; asks again for the shown paper's details |
| `navigate` | opens the folder (search, status tab, No text filter and selection reset) |
| `select` | selects one paper |
| `details` | shows the paper's annotations, reading position and file |
| `similar` | fills Related's similar content |
| `sidecarChanged` | asks again for the shown paper's details (`id` null: whatever paper is shown) |
| `jobs` | replaces the OCR jobs shown on rows and banners |
| `notice` | shows a toast (`info`, `ok`, `error`) |
| `progress` | shows a progress toast under a key; `text: null` dismisses it |
| `pdf.busy` | shows or clears the paper's PDF search spinner |
| `pdf.missing` | asks: Find PDF or Attach PDF |
| `pdf.findResult` | says what the search tried; offers Attach PDF or Search again |
| `add.sources` | lets the user pick a source |
| `add.noPdf` | asks: Search again or Save without PDF |

## Rules

- **The host never shows UI for a list action.** Prompts, confirmations, menus and pickers run in the UI before the message is sent; the host only does the work and replies with `notice`, `progress` or a result message. Native dialogs a platform requires (a file picker, a save dialog) are the exception.
- **Remove asks once.** The UI confirms, then sends `paper.remove`; every host moves the paper folders to the trash.
- **Every failure becomes an error notice.** A handler that throws is logged by the host and reported with `notice`.
- **Attach PDF is answered synchronously.** Browsers allow a file picker only inside a user gesture, so the UI sends `paper.attachPdf` from the click itself and an in-page host opens the picker before the post returns.
- **Status, tag and note changes show at once.** The UI applies them before sending; the next `snapshot` confirms or corrects them. A note being typed wins over the copy the host echoes back.
- **Folder changes go both ways.** The UI reports every folder the user opens with `navigate`; the host sends `navigate` for folders it opens itself (a new folder, a renamed or deleted one, the browser's back and forward, a folder picked in the VS Code tree). The UI does not echo the first folder it renders.
- **Heavy data is pulled.** Annotations, file size and similar papers arrive only for the paper on show, once per paper, and again after `sidecarChanged`.
- **Preferences are validated once.** Hosts pass stored values through `sanitizePrefs`.
