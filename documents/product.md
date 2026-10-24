# Product

Read when you design or change any UI, wording or user-facing behaviour.

LabShelf is a local-first manager for research papers. The library is an ordinary folder of PDFs and text files that the user owns; every app reads and writes that same format, and the user's own sync tool carries the folder between devices.

LabShelf ships as three apps of one product:

| App | Where it runs | What it is for |
|---|---|---|
| VS Code extension | VS Code | the full workspace: library, reader, import with OCR, similar-paper indexing |
| Browser extension | Chrome, Firefox | capture papers from the web, read and annotate them, browse the library without VS Code |
| Terminal app (`labshelf`) | any terminal | a keyboard-driven explorer and scriptable CLI over the same library |

The website that presents LabShelf is not one of these apps. It explains the product and links to the three apps.

## One product, three surfaces

When a user moves from one app to another, it should feel like the same product:

- **Same look.** Colours, type, spacing, icons and components come from the design system in core (see [architecture.md](architecture.md#design-system)). The VS Code extension and the browser extension share those components. The terminal maps the same colour tokens onto its palette.
- **Same words.** A folder is a "folder" and a paper is a "paper" in every app. The reading statuses are Unread, Reading and Done.
- **Same behaviour.** A feature that exists in two apps behaves the same in both, because its logic lives once in core. Examples are search and filters, citation formats, metadata lookup, and the reader with its keys.
- **Same first run.** LabShelf suggests a folder inside a sync tool the user already runs and never calls a cloud API itself.
- **Same data.** A paper added, read or annotated in one app shows up in the others: through the shared folder, which the user's sync tool carries between devices ([contracts/sync.md](contracts/sync.md)). The browser extension reaches the folder through a folder picked in Chromium or a small desktop host; without either, it keeps the library in the browser and warns that uninstalling the extension deletes it.

## Spaces

A Space groups references to papers, writing projects, dates and a manual glossary around one piece of work. Library and Projects remain global: a paper can belong to several Spaces without a copy, and removing a reference leaves the paper in the Library. Space folders organise references independently of Library folders.

VS Code and the browser share the Space catalog and pages. Spaces are personal; Members shows You. Sharing, activity, Notes, Discussions, Discover, Research chat and Glossary suggestions show unavailable controls that explain the missing capability. Their intended behaviour lives in [remaining ideas](ideas/spaces.md); storage and host rules live in the [Spaces contract](contracts/spaces.md).

## UX principles

1. **Paper-first, not a file explorer.** Zotero is the reference. Folders are for navigation and papers are the content, so a list shows papers only and never mixes folder rows into it. Folder structure appears as a path header, chips or a separate pane. Avoid file-manager idioms such as an "up" button or Backspace to go to the parent folder.
2. **Fluid navigation over features.** Navigating never rebuilds a view. Selection, scroll position and search survive a folder change. State is pushed to an open view rather than the view being reloaded.
3. **Abstract first.** The detail pane leads with what helps decide whether to read: title, authors, venue, abstract, then actions.
4. **Keyboard everywhere.** Every action has a key. The reader offers optional vim keys, and the terminal follows yazi's columns and keys while keeping Zotero's pane model (folders | papers | preview).
5. **Never lose the user's work.** LabShelf never deletes a file because of something it cannot explain. Destructive actions ask for confirmation.
6. **No emoji or Unicode glyphs as icons.** Icons are inline SVGs from the shared icon set. The terminal uses plain text or its own glyphs.
7. **Redesign within the structure.** A redesign polishes the existing structure (pane dividers, sortable column headers, tree twisties on the left) instead of stripping it; familiar structure is what makes the UI unambiguous.
8. **Preview-led templates.** The gallery gives document previews the main area. Sources, search and filters support browsing without a second navigation pane. Template details put the preview and the choice to create a project before technical metadata.
