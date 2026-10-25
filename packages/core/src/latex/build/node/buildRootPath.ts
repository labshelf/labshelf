/** Turns a project-relative file into the posix path TeX names it by, relative to the main file's folder. */
import * as path from "node:path";

// TRAP: the engine runs in main's folder, so include paths resolve from there, not from the project root.
export function mainFolderPath(projectFolder: string, main: string, file: string): string {
  return path.relative(path.dirname(path.join(projectFolder, main)), path.join(projectFolder, file)).split(path.sep).join("/");
}
