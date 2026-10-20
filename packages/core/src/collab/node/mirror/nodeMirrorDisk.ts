// Runs the mirror's disk over a project folder through Node: settled reads, atomic writes and a recursive watch.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { nodeFileReads } from "../../../writing/project/node/index.js";
import { assertRootReadable, listMirrorFiles, MirrorRootUnavailable, type MirrorDisk } from "../../mirror/disk/index.js";
import { watchFolder } from "./folderWatch.js";
import { readDisk } from "./stableRead.js";

/** The disk of the project folder at the absolute path `folder`. */
export function nodeMirrorDisk(folder: string, logger: ILogger): MirrorDisk {
  const full = (relative: string) => path.join(folder, ...relative.split("/"));
  const assertRoot = () => assertRootReadable(nodeFileReads, folder);
  return {
    async read(relative, stableMs) {
      try {
        const read = await readDisk(full(relative), stableMs);
        // TRAP: a file inside a deleted folder reads as missing too.
        if (read.state === "missing") { await assertRoot(); }
        return read;
      } catch (error) {
        if (!(error instanceof MirrorRootUnavailable)) { await assertRoot(); }
        throw error;
      }
    },
    async write(relative, bytes) {
      // The atomic write creates parent folders, so a deleted project folder would come back with a single file.
      await assertRoot();
      await writeFileAtomic(full(relative), bytes);
    },
    remove: (relative) => fs.rm(full(relative), { force: true }),
    list: () => listMirrorFiles(nodeFileReads, folder),
    watch: (onChange) => watchFolder(folder, onChange, logger),
  };
}
