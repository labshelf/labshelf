// The browser's deck Kits port for the Style panel: the kits folder at the library root over the library file system,
// and a logo picked through a hidden file input.
import { DECK_KIT_IMAGE_TOO_LARGE, DECK_KIT_MAX_IMAGE_BYTES, listDeckKits, posixPathOps, saveDeckKit, type DeckKitImage, type DeckKitsPort, type LibraryFileSystem } from "@labshelf/core";

const ACCEPT = "image/png,image/jpeg,image/svg+xml,image/webp,image/gif";

// PLATFORM: browsers open the file dialog only from the user's click, so the input is clicked before any await.
function pickKitImage(): Promise<DeckKitImage | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.hidden = true;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > DECK_KIT_MAX_IMAGE_BYTES) return reject(new Error(DECK_KIT_IMAGE_TOO_LARGE));
      file.arrayBuffer().then((buffer) => resolve({ name: file.name, bytes: new Uint8Array(buffer) }), reject);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** The kits of the library `fs` is rooted at, for the HTML and compiled deck tabs. */
export function createBrowserKitsPort(fs: LibraryFileSystem): DeckKitsPort {
  const deps = { fs, paths: posixPathOps, root: "" };
  return {
    list: () => listDeckKits(deps),
    save: (kit, logo) => saveDeckKit(deps, kit, logo),
    pickImage: pickKitImage,
  };
}
