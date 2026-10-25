// Probes the connection to LabShelf on this computer again and rebuilds the paper records when the library is now a folder.
import type { ILogger } from "@labshelf/core";
import { rebuildFromFiles, recheckLibrarySource, type LibrarySource } from "../../storage";

export async function recheckSource(logger: ILogger): Promise<LibrarySource> {
  const source = await recheckLibrarySource();
  await logger.log("INFO", "library.libraryLocation", "library source rechecked", { kind: source.kind });
  if (source.kind === "folder") await rebuildFromFiles(logger);
  return source;
}
