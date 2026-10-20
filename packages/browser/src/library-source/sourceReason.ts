// Explains in one sentence why the library is stored in the browser instead of a folder.
import type { LibrarySource } from "../storage";

export type BrowserSource = Extract<LibrarySource, { kind: "browser" }>;

export function sourceReason(source: BrowserSource): string {
  switch (source.reason) {
    case "not-installed": return "No folder is chosen, and neither LabShelf Helper nor LabShelf for VS Code or the terminal is connected to this browser.";
    case "protocol-mismatch": return "The browser extension and LabShelf on this computer are different releases. Update both to the same release.";
    case "no-library": return "LabShelf on this computer has no library folder yet. Enter one below, or choose it in VS Code or the terminal.";
    case "failed": return `The connection to LabShelf on this computer failed${source.detail ? `: ${source.detail}` : "."}`;
  }
}
