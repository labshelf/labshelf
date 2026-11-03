// The browser note file io (plan charts, D4/D5): files beside a note through a LibraryFileSystem, and a file pick through a hidden input.
import { posixPathOps, type NoteFileIo } from "@labshelf/core";

// PLATFORM: browsers open the file dialog only from the user's click, so the input is clicked before any await;
// the request reaches the in-page host in the same task as the click.
function pickTextFile(accept: readonly string[]): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === undefined) { resolve(null); return; }
      file.text().then((text) => resolve({ name: file.name, text }), reject);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** The io the browser surfaces serve a note's files through; `pick` is injected by tests. */
export function createBrowserNoteFileIo(fs: NoteFileIo["fs"], pick: NoteFileIo["pick"] = pickTextFile): NoteFileIo {
  return { fs, join: posixPathOps.join, pick };
}
