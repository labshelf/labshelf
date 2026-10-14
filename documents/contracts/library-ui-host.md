# Contract: library UI and its hosts

The library UI (folder header, filter bar, paper list, detail pane) is one UI in core that a host mounts once. The host owns the library data, every mutation, files, the clipboard and the reader. The UI owns everything on screen, including every dialog, picker and prompt. They talk only through the typed message unions in core's `library-ui/protocol` module, which is the single source of truth for message shapes. Every payload is plain JSON: arrays, never Sets.

The browser library page is a host today. It answers the UI over an in-page loopback channel and adds its own glue around the mounted UI: the folder tree in the sidebar slot, the URL hash, and the sync status bar.

## Startup

1. The host starts listening on its end of the channel, then calls `mountLibraryUi(element, { transport, prefs, withSidebar })`. `prefs` is a `PrefsPort` over the host's storage. The UI starts empty and shows "Loading…".
2. The UI sends `ready`.
3. The host answers with `navigate` to the folder it wants open (the browser reads it from the URL hash) and then `snapshot` with the folder tree, every paper record and the record paths that have a PDF.
4. The host may send `select` for a paper to show first.

## Messages

UI to host:

| Message | Sent when | Host answers |
|---|---|---|
| `ready` | the UI is mounted | `navigate`, `snapshot`, optionally `select` |
| `navigate` | the user opened another folder | nothing; the host keeps the folder for later replies |
| `folder.create`, `folder.rename`, `folder.delete` | the user confirmed the prompt | `snapshot`, then `navigate` when the open folder moved or was deleted |
| `paper.open` | Enter, double-click, Open PDF | opens the reader, or `pdf.missing` when the paper has no readable PDF |
| `paper.findPdf` | Find PDF | `pdf.busy`, `progress`, then `snapshot` with a `notice`, or `pdf.findResult` when nothing was found |
| `paper.attachPdf` | Attach PDF | opens a file picker in the same call; `snapshot` and a `notice` once a file is attached |
| `paper.setStatus` | badge click, status segment, Alt+1 to Alt+3 | `snapshot`; a `notice` for papers that failed |
| `paper.move` | drop on a folder, Move to | `snapshot` and a `notice` |
| `paper.remove` | the user confirmed Remove | `snapshot` and a `notice` |
| `paper.add` | Add | `add.sources`, or a `notice` when there is nothing to add from |
| `paper.addFrom` | the user picked a source, or answered the "No PDF found" dialog | `progress`, then `snapshot`, `select` and a `notice`, or `add.noPdf` |
| `clipboard.write` | Copy Key, Cmd/Ctrl+C | a `notice` |

Host to UI:

| Message | UI does |
|---|---|
| `snapshot` | replaces the library; records equal to the ones it holds keep their identity, so unchanged rows keep their DOM nodes |
| `navigate` | opens the folder (search, status tab and selection reset) |
| `select` | selects one paper |
| `notice` | shows a toast (`info`, `ok`, `error`) |
| `progress` | shows a progress toast under a key; `text: null` dismisses it |
| `pdf.busy` | shows or clears the paper's PDF search spinner |
| `pdf.missing` | asks: Find PDF or Attach PDF |
| `pdf.findResult` | says what the search tried; offers Attach PDF or Search again |
| `add.sources` | lets the user pick a source |
| `add.noPdf` | asks: Search again or Save without PDF |

## Rules

- **The host never shows UI for a list action.** Prompts, confirmations and pickers run in the UI before the message is sent; the host only does the work and replies with `notice`, `progress` or a result message.
- **Every failure becomes an error notice.** A handler that throws is logged by the host and reported with `notice`.
- **Attach PDF is answered synchronously.** Browsers allow a file picker only inside a user gesture, so the UI sends `paper.attachPdf` from the click itself and an in-page host opens the picker before the post returns.
- **A status change shows at once.** The UI applies it before sending `paper.setStatus`; the next `snapshot` confirms or corrects it.
- **Folder changes go both ways.** The UI reports every folder the user opens with `navigate`; the host sends `navigate` for folders it opens itself (a new folder, a renamed or deleted one, the browser's back and forward). The UI does not echo the first folder it renders.
- **Preferences are validated once.** Hosts pass stored values through `sanitizePrefs`; the browser keeps them in localStorage under `labshelf.library.prefs`, together with its tree's expanded folders.
