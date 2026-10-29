// Gives ProjectNotesStore and the "Send to…" writer the files of a library project: every path is relative to the project folder.
import type { IProjectAssetWriter, IProjectNoteFiles, LibraryFileSystem } from "@labshelf/core";

/** Resolves a project id to its folder in the library; rejects when the project is not there. */
export type ProjectFolderOf = (projectId: string) => Promise<string>;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Every file under `dir` as a path relative to `base`; dot folders (the project's own bookkeeping) are skipped. */
async function listFiles(fs: LibraryFileSystem, base: string, dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of await fs.listDir(dir ? `${base}/${dir}` : base)) {
    if (name.startsWith(".")) continue;
    const path = dir ? `${dir}/${name}` : name;
    const stat = await fs.stat(`${base}/${path}`);
    if (stat?.isDirectory) found.push(...await listFiles(fs, base, path));
    else if (stat?.isFile) found.push(path);
  }
  return found;
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function createProjectNoteFiles(fs: LibraryFileSystem, folderOf: ProjectFolderOf): IProjectNoteFiles {
  return {
    list: async (projectId) => listFiles(fs, await folderOf(projectId), ""),
    async read(projectId, path) {
      const file = `${await folderOf(projectId)}/${path}`;
      return (await fs.stat(file))?.isFile ? decoder.decode(await fs.readFile(file)) : null;
    },
    async write(projectId, path, text) {
      const folder = await folderOf(projectId);
      const dir = dirname(path);
      if (dir) await fs.ensureDir(`${folder}/${dir}`);
      await fs.writeFile(`${folder}/${path}`, encoder.encode(text));
    },
  };
}

export function createProjectAssetWriter(fs: LibraryFileSystem, folderOf: ProjectFolderOf): IProjectAssetWriter {
  return {
    async write(projectId, path, bytes) {
      const folder = await folderOf(projectId);
      const dir = dirname(path);
      if (dir) await fs.ensureDir(`${folder}/${dir}`);
      await fs.writeFile(`${folder}/${path}`, bytes);
    },
  };
}
