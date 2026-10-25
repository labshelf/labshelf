// Probes the connection to LabShelf on this computer again and rebuilds the paper records when the library is now a folder.
import type { ILogger } from "@labshelf/core";
import { refreshFromFiles, refreshStoredLibraryLocation, type LibraryLocation } from "../../storage";

export async function refreshLibraryLocation(logger: ILogger): Promise<LibraryLocation> {
  const source = await refreshStoredLibraryLocation();
  await logger.log("INFO", "library.libraryLocation", "library source rechecked", { kind: source.kind });
  if (source.kind === "folder") await refreshFromFiles(logger);
  return source;
}
