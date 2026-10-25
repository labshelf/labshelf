/** Gives the mirror tests one way to make a project folder and touch its files, over a Node temp dir or an in-memory library. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createLibraryMirrorFileSystem, type MirrorFileSystem } from "../../../src/collab/mirror/index";
import { createNodeMirrorFileSystem } from "../../../src/collab/node/index";
import type { ILogger } from "../../../src/ports/index";
import { NodeLibraryFileSystem } from "../../../src/library/node/index";
import { createWriteRecordStore, type WriteRecordStore } from "../../../src/library/writeRecords/index";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

export interface MirrorFiles {
  name: string;
  newFolder(label: string): Promise<string>;
  disk(folder: string, logger: ILogger): MirrorFileSystem;
  recordPaths(folder: string): Promise<string[]>;
  records(folder: string, logger: ILogger): WriteRecordStore;
  read(folder: string, file: string): Promise<Uint8Array | undefined>;
  write(folder: string, file: string, content: string | Uint8Array): Promise<void>;
  remove(folder: string, file: string): Promise<void>;
  removeFolder(folder: string): Promise<void>;
}

const deviceIds = new Map<string, string>();
const identity = (folder: string) => ({ id: async () => {
  if (!deviceIds.has(folder)) { deviceIds.set(folder, crypto.randomUUID()); }
  return deviceIds.get(folder)!;
} });

const bytes = (content: string | Uint8Array) => typeof content === "string" ? new TextEncoder().encode(content) : content;

export const tempDir = (label: string) => fs.mkdtemp(path.join(os.tmpdir(), `labshelf-${label}-`));

export const nodeFiles: MirrorFiles = {
  name: "node folder",
  recordPaths: async (folder) => (await fs.readdir(path.join(folder, ".labshelf/writes"))).map((file) => `.labshelf/writes/${file}`),
  records: (folder, logger) => createWriteRecordStore(new NodeLibraryFileSystem(), folder, identity(folder), logger),
  newFolder: (label) => tempDir(label),
  disk: (folder, logger) => createNodeMirrorFileSystem(folder, logger),
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
    recordPaths: async (folder) => [...library.files.keys()].filter((file) => file.startsWith(`${folder}/.labshelf/writes/`)).map((file) => file.slice(folder.length + 1)),
    records: (folder, logger) => createWriteRecordStore(library, folder, identity(folder), logger),
    async newFolder() {
      folders += 1;
      await library.mkdir(`/project-${folders}`);
      return `/project-${folders}`;
    },
    disk: (folder) => createLibraryMirrorFileSystem(library, folder),
    read: async (folder, file) => library.files.get(`${folder}/${file}`),
    async write(folder, file, content) {
      await library.ensureDir(path.posix.dirname(`${folder}/${file}`));
      await library.writeFile(`${folder}/${file}`, bytes(content));
    },
    remove: (folder, file) => library.deleteFile(`${folder}/${file}`),
    removeFolder: (folder) => library.removeTree(folder),
  };
}
