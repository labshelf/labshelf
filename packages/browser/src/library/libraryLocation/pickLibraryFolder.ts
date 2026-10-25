// Lets the user pick the library folder on disk in a browser that can open folders, and switches the library to it.
import type { ILogger } from "@labshelf/core";
import { sendPickedDirChange, refreshFromFiles, writePickedDir, attachPickedDir, type LibraryLocation } from "../../storage";

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
