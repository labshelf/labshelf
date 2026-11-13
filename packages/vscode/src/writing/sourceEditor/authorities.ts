// The one registry of the source authorities of the documents open in a LabShelf editor or a consult window: one authority per URI, shared by every client of the file.
import * as vscode from "vscode";
import { createSourceAuthority, type SourceAuthority } from "@labshelf/core";

export function lineBreakOf(document: vscode.TextDocument): "\n" | "\r\n" {
  return document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
}

/** Acquires and releases a document's authority: created with its first client, dropped with its last. */
export interface SourceAuthorities {
  acquire(document: vscode.TextDocument): SourceAuthority;
  release(document: vscode.TextDocument): void;
}

function createAuthorities(): SourceAuthorities {
  const open = new Map<string, { authority: SourceAuthority; clients: number }>();
  return {
    acquire(document) {
      const key = document.uri.toString();
      const entry = open.get(key) ?? { authority: createSourceAuthority({ text: document.getText(), lineBreak: lineBreakOf(document) }), clients: 0 };
      entry.clients += 1;
      open.set(key, entry);
      return entry.authority;
    },
    release(document) {
      const key = document.uri.toString();
      const entry = open.get(key);
      if (!entry) { return; }
      entry.clients -= 1;
      if (entry.clients <= 0) { open.delete(key); }
    },
  };
}

/** The extension's registry: the source editor panels and the consult windows of every panel acquire from it. */
export const sourceAuthorities: SourceAuthorities = createAuthorities();
