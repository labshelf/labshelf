// Decides the local folder name of each Drive folder in the "library" namespace.
// The rank of each answer lets scanRemoteTree settle two folders claiming one name: the stronger claim keeps it.
import { METADATA_FILE, parsePaperMetadata } from "../../../library/index.js";
import type { RemoteProvider } from "../../provider/index.js";
import type { SyncManifest } from "../state/index.js";
import type { FolderNaming, RemoteFolderNamer } from "../pipeline/index.js";

export interface LibraryFolderNamerDeps {
  provider: RemoteProvider;
  manifest: SyncManifest;
  /** Remote display name → local folder name, from the surface's own index (titles → paper ids). */
  titles?: Map<string, string>;
}

/** Whether a cite key can be used as a folder name on every platform the library syncs to. */
export function isSafeFolderName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== "." && name !== ".." && !/[\x00-\x1f\x7f/\\]/.test(name);
}

// CONTRACT: documents/contracts/sync.md#folder-names
// TRAP: Drive names papers by title but locally they are named by id; a device that does not know a title yet (or
// knows an older one) would bring the folder down under its title, giving the paper a second id and orphaning its
// sidecar. Rules, in order:
//  1. A folder synced before keeps the local name its files were synced under (manifest, by remote file id), so a
//     title change never renames anything on disk.
//  2. A paper folder new to this device is named after the citekey in its metadata.yaml, which every surface writes
//     equal to the paper id (preferred over the title, which two papers may share).
//  3. A title this device knows maps to its paper id.
//  4. Otherwise the display name is kept (collections, foreign folders).
export function createLibraryFolderNamer(deps: LibraryFolderNamerDeps): RemoteFolderNamer {
  const pathByRemoteId = new Map<string, string>();
  for (const path of deps.manifest.paths("library")) {
    const entry = deps.manifest.get("library", path);
    if (entry) { pathByRemoteId.set(entry.remoteId, path); }
  }
  const titled = (folder: { name: string }): FolderNaming | undefined => {
    const id = deps.titles?.get(folder.name);
    return id ? { name: id, rank: 3 } : undefined;
  };
  return async (folder, children) => {
    for (const child of children) {
      if (child.isFolder) { continue; }
      const known = pathByRemoteId.get(child.id);
      const parts = known?.split("/");
      const name = parts && parts.length >= 2 ? parts[parts.length - 2] : undefined;
      if (name) { return { name, rank: 1 }; }
    }
    const metadata = children.find((child) => !child.isFolder && child.name === METADATA_FILE);
    if (!metadata) { return titled(folder); }
    try {
      const meta = parsePaperMetadata(new TextDecoder("utf-8").decode(await deps.provider.download(metadata.id)));
      const citekey = meta?.["citekey"];
      if (typeof citekey === "string" && isSafeFolderName(citekey.trim())) { return { name: citekey.trim(), rank: 2 }; }
    } catch {
      // Unreadable metadata: fall back to the title or the display name rather than failing the whole sync.
    }
    return titled(folder);
  };
}
