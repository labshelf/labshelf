// Translates the sharing dialogs' library paths ("papers/…") to the disk paths the core folder-link operations run on, and back.
import type { SharingHost } from "@labshelf/core";
import type { LibraryPaths } from "../../ui/list/index.js";

const OUTSIDE = "This folder is outside the library.";

function diskPath(paths: LibraryPaths, ui: string): string {
  const abs = paths.fromUi(ui);
  // TRAP: fromUi joins whatever it is given, so only a round trip proves the path names a folder under papers/.
  if (paths.toUi(abs) !== ui) { throw new Error(OUTSIDE); }
  return abs;
}

/** `paths` is read per call, since the open library can change under the host. */
export function withLibraryPaths(host: SharingHost, paths: () => LibraryPaths): SharingHost {
  return {
    ...host,
    shareableFolder: async (ui) => {
      const lib = paths();
      const folder = await host.shareableFolder(diskPath(lib, ui));
      return folder && { ...folder, path: lib.toUi(folder.path) ?? ui };
    },
    shareFolder: async (ui, withAnnotations, onProgress) => host.shareFolder(diskPath(paths(), ui), withAnnotations, onProgress),
    openFolder: async (ui) => host.openFolder(diskPath(paths(), ui)),
    importLink: async (text, onProgress) => {
      const result = await host.importLink(text, onProgress);
      if (result.kind !== "imported" || result.folder === undefined) { return result; }
      const folder = paths().toUi(result.folder);
      return folder === null ? { kind: "imported", summary: result.summary } : { ...result, folder };
    },
    sharedLinks: async () => {
      const lib = paths();
      return (await host.sharedLinks()).map((link) => ({ ...link, folder: lib.toUi(link.folder) ?? link.folder }));
    },
  };
}
