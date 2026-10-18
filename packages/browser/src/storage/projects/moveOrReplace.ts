// Moves a library file or folder, replacing an existing file at the target by writing it whole before the source goes.
import type { LibraryFileSystem } from "@labshelf/core";

const isCaseOnly = (from: string, to: string): boolean => from !== to && from.toLowerCase() === to.toLowerCase();

// A staged write renames its temporary file onto the real one, which the bridge's rename refuses while the target exists.
export async function moveOrReplace(fileSystem: LibraryFileSystem, source: string, target: string): Promise<void> {
  // TRAP: on a case-insensitive disk the case-only target stats as the source itself; copying onto it would lose the file.
  const existing = isCaseOnly(source, target) ? undefined : await fileSystem.stat(target);
  if (!existing?.isFile) return fileSystem.rename(source, target);
  await fileSystem.writeFile(target, await fileSystem.readFile(source));
  await fileSystem.deleteFile(source);
}
