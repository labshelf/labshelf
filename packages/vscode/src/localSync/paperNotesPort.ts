// The paper notes port over the window's open notes.qmd: reads see the document's text and writes edit and save it,
// so a reader note never lands on disk behind an open editor; a closed notes file goes to the inner port.
import type * as vscode from "vscode";

import type { PaperNotesPort } from "@labshelf/core";
import { openDocumentOf, writeThroughDocument } from "./documentText.js";

export function createDocumentPaperNotesPort(inner: PaperNotesPort, notesPath: (paperId: string) => string | undefined, uriOf: (path: string) => vscode.Uri): PaperNotesPort {
  return {
    async read(paperId) {
      const path = notesPath(paperId);
      const document = path === undefined ? undefined : openDocumentOf(uriOf(path));
      return document ? document.getText() : inner.read(paperId);
    },
    async write(paperId, text) {
      const path = notesPath(paperId);
      if (path !== undefined && await writeThroughDocument(uriOf(path), text)) return;
      await inner.write(paperId, text);
    },
  };
}
