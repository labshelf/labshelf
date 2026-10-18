// Finds the writing projects under the library's projects folder, all as entries or one by its id.
import {
  PROJECTS_DIR, PROJECT_FILE, parseProjectFile, readProjectEntry,
  type ILogger, type LibraryFileSystem, type ProjectEntry, type ProjectFolderReader,
} from "@labshelf/core";

/** A missing projects folder lists as empty: the bridge returns no names for it. */
async function projectFolders(fileSystem: LibraryFileSystem): Promise<string[]> {
  const folders = (await fileSystem.listDir(PROJECTS_DIR))
    .filter((name) => !name.startsWith("."))
    .map((name) => `${PROJECTS_DIR}/${name}`);
  const stats = await Promise.all(folders.map((folder) => fileSystem.stat(folder)));
  return folders.filter((_, index) => stats[index]?.isDirectory === true);
}

/** A name that is not a file reads as absent, like a missing file on disk. */
async function readOptionalText(fileSystem: LibraryFileSystem, file: string): Promise<string | undefined> {
  return (await fileSystem.stat(file))?.isFile ? fileSystem.readText(file) : undefined;
}

function folderReader(fileSystem: LibraryFileSystem, folder: string): ProjectFolderReader {
  return {
    readOptionalText: (name) => readOptionalText(fileSystem, `${folder}/${name}`),
    rootFileNames: async () => {
      const names = await fileSystem.listDir(folder);
      const stats = await Promise.all(names.map((name) => fileSystem.stat(`${folder}/${name}`)));
      return names.filter((_, index) => stats[index]?.isFile === true);
    },
    exists: async () => (await fileSystem.stat(folder))?.isDirectory === true,
  };
}

export async function listLibraryProjects(fileSystem: LibraryFileSystem, logger: ILogger): Promise<ProjectEntry[]> {
  const folders = await projectFolders(fileSystem);
  return Promise.all(folders.map((folder) =>
    readProjectEntry({ folder, location: "library", reader: folderReader(fileSystem, folder), logger })));
}

/** Reads only each labshelf.yaml; a file system failure is thrown, a missing or unparseable yaml never matches. */
export async function findLibraryProjectFolder(fileSystem: LibraryFileSystem, id: string): Promise<string | undefined> {
  for (const folder of await projectFolders(fileSystem)) {
    const text = await readOptionalText(fileSystem, `${folder}/${PROJECT_FILE}`);
    const parsed = text === undefined ? undefined : parseProjectFile(text);
    if (parsed?.ok && parsed.settings.id === id) return folder;
  }
  return undefined;
}
