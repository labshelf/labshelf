# Contract: library UI and its hosts

Read when you change the library UI or the code that hosts it.

The library UI (folder header, paper list, paper menu, detail pane, citation map) is one UI in core that a host mounts once. The host owns the library data, every mutation, files, the clipboard and the reader. The UI owns everything on screen, including every dialog, menu, picker and prompt, and builds every text it shows or copies (citations, BibTeX, annotation Markdown) from the records. They talk only through the typed message unions in core's `library-ui/protocol` module, which is the single source of truth for message shapes. Every payload is plain JSON: arrays, never Sets.

Two hosts mount it:

- **VS Code** runs it in the list webview and answers over `postMessage`. The webview is untrusted: the extension host passes every message through `parseUiMessage` and drops what fails it. Prefs live in the webview state.
- **The browser library page** runs it in the page and answers over an in-page loopback channel. Its own glue sits around the mounted UI: the shared library sidebar (`mountLibrarySidebar`, with Projects) in the sidebar slot, the URL hash. Prefs live in localStorage under `labshelf.library.prefs`, together with the tree's expanded folders.

## Paths

The UI names folders and papers by "/"-separated paths that start at `papers` (the library root). A host whose files live elsewhere maps them both ways and never shows the UI an absolute path. A path the host receives must be `papers` or below it, with no empty, `.` or `..` segment.

## Startup

1. The host starts listening on its end of the channel, then calls `mountLibraryUi(element, { transport, prefs, capabilities, labels, withSidebar })`. `prefs` is a `PrefsPort` over the host's storage. The UI starts empty and shows "Loading…".
2. The UI sends `ready`.
3. The host answers with `navigate` to the folder it wants open and then `snapshot`: the folder tree, every paper record, the record paths that have a PDF on this device, and reading stats by paper id (annotation count, last page, last read, and the most recently changed highlight with its page).
4. The host may send `select` or `reveal` for a paper to show first, and `jobs` with the OCR running.

A host that can post before the UI is listening (VS Code, whose webview loads after the panel opens) keeps every message it sends before `ready` and delivers them, in order, after its answers to `ready`.

## Capabilities and labels

Shared actions (open, status, move, remove, copy, folders, tags, notes, annotations and their export, keywords as searches, Related without similar content, a paper's files and their descriptions) work on every host, and every host answers `paper.details`, `paper.setTags`, `paper.setNote`, `annotations.export`, `paper.files`, `paper.describeFile`, `paper.openFile` and `paper.copyFilePath`, and sends `sidecarChanged`. Everything else is a capability the host declares at mount; a capability left out hides every control that would send its message:

| Capability | Host answers | VS Code | Browser |
|---|---|---|---|
| `textLayer` | `paper.makeSearchable`; sends `jobs`; the UI shows the no-text row marks and banners | yes | no |
| `similar` | `paper.similar` | yes | no |
| `reveal`, `openExternal`, `fetchMetadata` | the message of the same name; `reveal` also covers `paper.revealFile` | yes | no |
| `findPdf`, `attachPdf` | `paper.findPdf`, `paper.attachPdf` | no | yes |
| `askAuthor` | `paper.askAuthor` | no | yes |

Labels are the few texts that name a host's own way of working: the Add button's tooltip, the empty folder's hint, and the name of the reveal action.

## Messages

UI to host:

| Message | Sent when | Host answers |
|---|---|---|
| `ready` | the UI is mounted | `navigate`, `snapshot`, optionally `select` and `jobs` |
| `navigate` | the user opened another folder | nothing; the host keeps the folder for later replies |
| `folder.open` | Details (see [details-host.md](details-host.md)) asks to open a paper's folder in the list, which it does not hold | forwards `navigate` with the folder to the list |
| `folder.create`, `folder.rename`, `folder.delete` | the user confirmed the prompt | `snapshot`, then `navigate` when the open folder moved or was deleted |
| `paper.open` | Enter, double-click, Open PDF, an annotation (with its `page`) | opens the reader, or `pdf.missing` when the paper has no readable PDF |
| `paper.details` | a paper is shown in the detail pane | `details` |
| `paper.similar` | the Related tab is shown | `similar` |
| `paper.selected` | the selection changed, whether the user selected or a host message did; `ids` holds every selected paper and is empty when none is | nothing; a host with its own tree marks the paper there when exactly one is selected |
| `paper.files` | a paper's files are opened in the list | `files` |
| `paper.describeFile` | the user confirmed Describe… on a file or subfolder; an empty `description` removes the stored one | writes the `files` key of the paper's metadata.yaml, then `snapshot` and `files` |
| `paper.openFile` | Open to the side on a file of the paper | opens it beside the list: paper.pdf in the reader, any other file in the host's own viewer |
| `paper.revealFile` | Reveal on a file or subfolder of the paper | shows it in the system file manager |
| `paper.copyFilePath` | Copy path on a file or subfolder of the paper | copies its path (absolute on a host with a file system, else from `papers`) and sends a `notice` |
| `paper.setStatus` | badge click, detail status button, menu, Alt+1 to Alt+3 | `snapshot`; a `notice` for papers that failed |
| `paper.setTags` | a tag added or removed in the detail pane | `snapshot`; a `notice` for papers that failed |
| `paper.setNote` | the note was typed and paused, or left | `snapshot` |
| `paper.move` | drop on a folder, Move to | `snapshot` and a `notice` |
| `paper.remove` | the user confirmed Remove | moves the folders to the trash; `snapshot` and a `notice` |
| `paper.makeSearchable` | Make searchable | `jobs` while OCR runs, then `snapshot` |
| `paper.openExternal`, `paper.reveal`, `paper.fetchMetadata`, `annotations.export` | the menu or the detail pane | does it |
| `paper.findPdf` | Find PDF | `pdf.busy`, `progress`, then `snapshot` with a `notice`, or `pdf.findResult` when nothing was found |
| `paper.attachPdf` | Attach PDF | opens a file picker in the same call; `snapshot` and a `notice` once a file is attached |
| `paper.add` | Add | `add.sources`, or opens the host's own import, or a `notice` when there is nothing to add from |
| `paper.openForPdf` | Open page, in the PDF dialogs, when the miss carries an `access` page | opens that page in a visible tab and attaches the PDF once it yields one; only a host with a browser session sets `access` |
| `paper.askAuthor` | Ask the author, in the detail pane of a paper without a PDF or in the "No PDF found" dialog | `progress`, then opens the request email in the user's mail client, records `pdfRequestedAt` and sends `snapshot` with a `notice`; with no author address it opens the article page and records nothing |
| `paper.addFrom` | the user picked a source, or answered the "No PDF found" dialog; `ifNoPdf: "author"` saves the reference and then does what `paper.askAuthor` does | `progress`, then `snapshot`, `select` and a `notice`, or `add.noPdf` |
| `clipboard.write` | any copy; `label` names what was copied | a `notice` |
| `project.openSource` | a Cited in row; `file` is "/"-separated below the project folder, `line` zero-based | opens the file at the line |
| `citationMap.refresh` | Refresh or Try again in the citation map | `citationMap.show` with `loading`, then with `ready` or `failed` |
| `citationMap.import` | Import on a missing work; `workId` is an OpenAlex short id (`W` and digits), `doi` the work's DOI | imports the paper by its DOI; `snapshot`, a `notice` and `citationMap.imported`, or an error `notice` and `citationMap.importFailed` |

Host to UI:

| Message | UI does |
|---|---|
| `snapshot` | replaces the library; records and stats equal to the ones it holds keep their identity, so unchanged rows keep their DOM nodes; asks again for the shown paper's details |
| `navigate` | opens the folder, with its subfolders' papers grouped below its own (search and selection reset) |
| `select` | selects one paper |
| `reveal` | shows the paper wherever it is: opens its folder unless the open scope already holds it, clears the search when it hides it, selects it, opens its files and scrolls it into view; reports a folder change with `navigate`; an unknown id does nothing |
| `files` | fills the paper's file rows, or shows an inline error row when `state` is `failed` |
| `details` | shows the paper's annotations, reading position and file, and Cited in from `citedIn`: one row per project file and heading that cites the paper. Only a host that knows writing projects sends `citedIn` (VS Code); it answers `project.openSource` |
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
| `citationMap.show` | opens the citation map in place of the paper list, or updates it while it is open; `state` is `loading`, `ready` with the `map`, or `failed` with a `message` |
| `citationMap.imported` | drops the work's row and graph node |
| `citationMap.importFailed` | clears the work's busy Import button |

## Citation map

The citation map lists the works that at least three of the library's papers cite and the library lacks, most cited first, with a graph of the papers and those works. A host that offers it builds the map with `buildCitationMap` and opens the view by sending `citationMap.show`: VS Code from a command. A host that never sends it never shows the view, so no capability declares it.

- **The map names its papers.** `map.papers` holds the id and title of every library paper that a link or a missing work's `citedBy` mentions; `links` join library papers, and each missing work keeps the OpenAlex fields `buildCitationMap` returns.
- **The list carries every action.** Each row offers Import (disabled for a work without a DOI) and its citing papers, which send `paper.open`. The graph repeats these as mouse shortcuts: a paper's node sends `paper.open`, a missing work's node brings its row into view.
- **Folder navigation closes it.** The Papers button, a folder the user opens and a `navigate` from the host all return to the paper list. The list keys do nothing while the map is open.

## Rules

- **The host never shows UI for a list action.** Prompts, confirmations, menus and pickers run in the UI before the message is sent; the host only does the work and replies with `notice`, `progress` or a result message. Native dialogs a platform requires (a file picker, a save dialog) are the exception.
- **Remove asks once.** The UI confirms, then sends `paper.remove`; every host moves the paper folders to the trash.
- **Every failure becomes an error notice.** A handler that throws is logged by the host and reported with `notice`.
- **Attach PDF is answered synchronously.** Browsers allow a file picker only inside a user gesture, so the UI sends `paper.attachPdf` from the click itself and an in-page host opens the picker before the post returns.
- **Status, tag and note changes show at once.** The UI applies them before sending; the next `snapshot` confirms or corrects them. A note being typed wins over the copy the host echoes back.
- **Folder changes go both ways.** The UI reports every folder the user opens with `navigate`; the host sends `navigate` for folders it opens itself (a new folder, a renamed or deleted one, the browser's back and forward, a folder picked in the VS Code tree). The UI does not echo the first folder it renders.
- **Heavy data is pulled.** Annotations, file size and similar papers arrive only for the paper on show, once per paper, and again after `sidecarChanged`. A file listing arrives only for a paper whose files are open, each time they open.
- **Files are named inside their paper.** File messages carry the paper id and one entry name of its folder, never a path. The host lists, opens and describes only direct entries of that paper folder, and hides `metadata.yaml`, `bib.bib` and names starting with "." (see [library-format.md](library-format.md#layout)). A listing that fails is logged with the paper folder and answered with `files` in state `failed`.
- **Preferences are validated once.** Hosts pass stored values through `sanitizePrefs`.
