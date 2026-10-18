// Declares the typed envelope of every request the extension pages and content scripts send the background.
import type { CaptureMessage } from "./captureMessages";
import type { LibraryMessage } from "./libraryMessages";

export type RuntimeMessage = CaptureMessage | LibraryMessage;

export type RuntimeResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };
