// Sets the library folder on a host that has none, then rechecks the source so the library switches to the folder.
import type { ILogger } from "@labshelf/core";
import { setLibraryFolder, type LibrarySource } from "../storage";
import { recheckSource } from "./recheckSource";

export async function chooseLibraryFolder(root: string, logger: ILogger): Promise<LibrarySource> {
  await setLibraryFolder(root);
  return recheckSource(logger);
}
