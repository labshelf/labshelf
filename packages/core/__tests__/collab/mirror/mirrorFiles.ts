/** Gives the mirror tests one way to make a project folder and touch its files, over a Node temp dir or an in-memory library. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { libraryMirrorDisk, type MirrorDisk } from "../../../src/collab/mirror/index";
import { nodeMirrorDisk } from "../../../src/collab/node/index";
import type { ILogger } from "../../../src/ports/index";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

export interface MirrorFiles {
  name: string;
  newFolder(label: string): Promise<string>;
  disk(folder: string, logger: ILogger): MirrorDisk;
  read(folder: string, file: string): Promise<Uint8Array | undefined>;
  write(folder: string, file: string, content: string | Uint8Array): Promise<void>;
  remove(folder: string, file: string): Promise<void>;
  removeFolder(folder: string): Promise<void>;
}

const bytes = (content: string | Uint8Array) => typeof content === "string" ? new TextEncoder().encode(content) : content;

export const tempDir = (label: string) => fs.mkdtemp(path.join(os.tmpdir(), `labshelf-${label}-`));

export const nodeFiles: MirrorFiles = {
  name: "node folder",
  newFolder: (label) => tempDir(label),
  disk: (folder, logger) => nodeMirrorDisk(folder, logger),
  read: (folder, file) => fs.readFile(path.join(folder, file)).then((data) => new Uint8Array(data), () => undefined),
  async write(folder, file, content) {
    await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await fs.writeFile(path.join(folder, file), content);
  },
  remove: (folder, file) => fs.rm(path.join(folder, file)),
  removeFolder: (folder) => fs.rm(folder, { recursive: true }),
};

/** One in-memory library; each folder is a fresh "/project-<n>" in it. */
export function memoryFiles(): MirrorFiles {
  const library = new MemoryLibraryFs();
  let folders = 0;
  return {
    name: "library port",
    async newFolder() {
      folders += 1;
      await library.mkdir(`/project-${folders}`);
      return `/project-${folders}`;
    },
    disk: (folder) => libraryMirrorDisk(library, folder),
    read: async (folder, file) => library.files.get(`${folder}/${file}`),
    async write(folder, file, content) {
      await library.ensureDir(path.posix.dirname(`${folder}/${file}`));
      await library.writeFile(`${folder}/${file}`, bytes(content));
    },
    remove: (folder, file) => library.deleteFile(`${folder}/${file}`),
    removeFolder: (folder) => library.removeTree(folder),
  };
}
