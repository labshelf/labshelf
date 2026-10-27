// Asks the file system what a path is; a path that cannot be read counts as neither.
import { promises as fs } from "node:fs";

export function isDirectory(target: string): Promise<boolean> {
  return fs.stat(target).then((stat) => stat.isDirectory(), () => false);
}

export function isFile(target: string): Promise<boolean> {
  return fs.stat(target).then((stat) => stat.isFile(), () => false);
}
