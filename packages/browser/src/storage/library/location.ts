// Decides where the library lives for the user: why it is stored in the browser, a re-check of the connection and the pick of a folder on disk.
import type { ILogger } from "@labshelf/core";
import { attachPickedDir, refreshFromFiles, refreshStoredLibraryLocation, type LibraryLocation } from "../libraryFileSystem";
import { sendPickedDirChange, writePickedDir } from "../pickedDir";

export type BrowserSource = Extract<LibraryLocation, { kind: "browser" }>;

export function describeSourceReason(source: BrowserSource): string {
  switch (source.reason) {
    case "not-installed": return "No folder is chosen, and neither LabShelf Helper nor LabShelf for VS Code or the terminal is connected to this browser.";
    case "protocol-mismatch": return "The browser extension and LabShelf on this computer are different releases. Update both to the same release.";
    case "no-library": return "LabShelf on this computer has no library folder yet. Enter one below, or choose it in VS Code or the terminal.";
    case "failed": return `The connection to LabShelf on this computer failed${source.detail ? `: ${source.detail}` : "."}`;
  }
}

export async function refreshLibraryLocation(logger: ILogger): Promise<LibraryLocation> {
  const source = await refreshStoredLibraryLocation();
  await logger.log("INFO", "library.libraryLocation", "library source rechecked", { kind: source.kind });
  if (source.kind === "folder") await refreshFromFiles(logger);
  return source;
}

/** PLATFORM: Chromium browsers open folders on disk; Firefox does not, so there the folder goes through the bridge. */
export const canPickFolder = (): boolean => typeof window.showDirectoryPicker === "function";

/** Needs a click. @returns undefined when the user closes the picker */
export async function pickLibraryFolder(logger: ILogger): Promise<LibraryLocation | undefined> {
  let handle: FileSystemDirectoryHandle;
  try {
    // The id makes the picker open where the user picked last time.
    handle = await window.showDirectoryPicker!({ id: "labshelf-library", mode: "readwrite" });
  } catch (err) {
    if ((err as { name?: unknown }).name === "AbortError") return undefined;
    throw err;
  }
  await writePickedDir(handle);
  sendPickedDirChange();
  const source = await attachPickedDir();
  await logger.log("INFO", "library.libraryLocation", "library folder picked", { name: handle.name });
  await refreshFromFiles(logger);
  return source;
}
