# Track changes

Coauthors suggest edits instead of making them. Each insertion and deletion in a project source shows inline, marked with its author and time, until someone accepts or rejects it. This is the review flow of Overleaf and Word, and it is separate from project history and versions, which look back at what changed.

## Behaviour

- **Suggest mode** is a per-person toggle in the editor. While it is on, typing inserts marked text and deleting strikes text through instead of removing it.
- **Review.** A suggestion shows the author's colour and name. Accept applies it, Reject removes it, and both are one click on the suggestion or in a list of all open suggestions in the project.
- **Accept all / Reject all** per file and per author.
- **Comments** attach to a suggestion like any other range, so a reviewer can explain a change.
- **Build.** The PDF always builds from the text with every open suggestion applied as if accepted, so the preview shows the proposed document; a toggle builds the text without them.
- The same suggestions show in VS Code and in the browser editor, live in a shared project.

## Open questions

- Storage: suggestions as Yjs relative ranges on the file's shared document, next to comments, or as a separate map that survives outside a live session.
- What a person outside a shared project sees in a file that still has open suggestions on disk.
- Whether a project can require suggest mode for some coauthors.
