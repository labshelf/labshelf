// Names the library a source serves with a stable id, so per-library data such as share keys stays apart.
import { sha256Hex } from "@labshelf/core";
import { getLibrarySource, type LibrarySource } from "./libraryFileSystem";
import { loadPickedFolderId } from "./pickedDir";

const BROWSER_LIBRARY_ID = "browser";
const BRIDGE_ID_HEX_CHARS = 16;

/** `pickedId` is the id stored with the picked folder; only a picked source reads it. */
export async function libraryIdOf(source: LibrarySource, pickedId: string | undefined): Promise<string> {
  if (source.kind === "browser") return BROWSER_LIBRARY_ID;
  if (source.via === "bridge") return `bridge:${(await sha256Hex(new TextEncoder().encode(source.root))).slice(0, BRIDGE_ID_HEX_CHARS)}`;
  if (pickedId === undefined) throw new Error(`The picked folder ${source.root} has no stored library id`);
  return pickedId;
}

export async function currentLibraryId(): Promise<string> {
  const source = await getLibrarySource();
  return libraryIdOf(source, source.kind === "folder" && source.via === "picked" ? await loadPickedFolderId() : undefined);
}
