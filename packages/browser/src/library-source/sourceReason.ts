// Explains in one sentence why the library is stored in the browser instead of a folder.
import type { LibrarySource } from "../storage";

export type BrowserSource = Extract<LibrarySource, { kind: "browser" }>;

export function sourceReason(source: BrowserSource): string {
  switch (source.reason) {
    case "not-installed": return "LabShelf for VS Code or the terminal is not connected to this browser yet.";
    case "protocol-mismatch": return "The browser extension and LabShelf on this computer are different releases. Update both to the same release.";
    case "no-library": return "LabShelf on this computer has no library folder yet. Choose one below, or in VS Code or the terminal.";
    case "failed": return `The connection to LabShelf on this computer failed${source.detail ? `: ${source.detail}` : "."}`;
  }
}
