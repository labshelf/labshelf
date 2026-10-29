# Product

Read when you decide what a feature does or what it says. How it looks is in [ui.md](ui.md).

## General

- LabShelf is a local-first manager for research papers, shipped as a VS Code extension, a browser extension and a terminal app. 
- Concepts stay the same across apps. A folder is a "folder" and a paper is a "paper" in every app.
- The user's own sync tool (Dropbox, Google Drive, iCloud Drive, Syncthing, any other) moves the folder between devices. 

## Library

- The Library is LabShelf's Zotero or Paperpile: it holds every paper the user has, with its metadata, and annotations. Folders organise papers for navigation.
- Without a folder, the browser extension keeps the library in the browser and warns that uninstalling the extension deletes it.

## Projects

- Projects are LabShelf's Overleaf or Typst app: a project is a writing project that cites papers from the Library and builds to a PDF. Coauthors can share a project.
- A project has notes, plain `.qmd` files in the project. The browser sidebar has New note, and a note opens as a source tab of the project. The checklist counts note tasks and ticks them in the note.
- The reader's Send to appends the quoted passage and its page link to a project note, or to a new one. The last targets are remembered per device.
- A manuscript line that cites a paper with notes shows how many notes it has: a code lens and hover in VS Code, a gutter marker and popover in the browser source editor.

## Spaces

- A Space groups references to papers, projects, dates and a glossary around one piece of work. Library and Projects stay global: a paper or project can belong to several Spaces without a copy, and removing a reference leaves it in place. Space folders organise references independently of Library folders.
- A capability a Space does not have yet shows as an unavailable control that explains what is missing.
