// Finds the one directory an installer archive unpacked into.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function singleTopDir(parent: string): Promise<string> {
  const dirs = (await readdir(parent, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const [only] = dirs;
  if (dirs.length !== 1 || only === undefined) {
    throw new Error(`Expected one directory in the unpacked installer at ${parent}, found ${dirs.map((dir) => dir.name).join(", ") || "none"}`);
  }
  return join(parent, only.name);
}
