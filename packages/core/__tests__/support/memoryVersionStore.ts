// Builds a device-local version store held in memory, for scans that need merge bases.
import * as path from "node:path";

import { FileProjectVersionStore } from "../../src/writing/conflict/index";
import { MemoryLibraryFs } from "./memoryLibraryFs";

export function memoryVersionStore(): FileProjectVersionStore {
  return new FileProjectVersionStore(new MemoryLibraryFs(), path.posix, "/state/merge-bases");
}
