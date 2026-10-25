/** Gives the Typst compiler synchronous access to the local file system, and maps file paths to compiler paths and back. */
import * as fs from "node:fs";
import * as path from "node:path";

import type { TypstFileAccess } from "../typstSession.js";

// PLATFORM: the compiler's paths are POSIX; a Windows drive path becomes "/C:/...".
export function deriveTypstCompilerPath(file: string): string {
  const posix = file.split(path.sep).join("/");
  return posix.startsWith("/") ? posix : `/${posix}`;
}

export function deriveFilePathFromCompilerPath(compilerPath: string): string {
  const native = /^\/[A-Za-z]:\//.test(compilerPath) ? compilerPath.slice(1) : compilerPath;
  return native.split("/").join(path.sep);
}

function statOf(compilerPath: string): fs.Stats | undefined {
  return fs.statSync(deriveFilePathFromCompilerPath(compilerPath), { throwIfNoEntry: false });
}

export const nodeTypstFiles: TypstFileAccess = {
  getMTime: (compilerPath) => statOf(compilerPath)?.mtime,
  isFile: (compilerPath) => statOf(compilerPath)?.isFile(),
  getRealPath: (compilerPath) => compilerPath,
  readAll: (compilerPath) => {
    try {
      return new Uint8Array(fs.readFileSync(deriveFilePathFromCompilerPath(compilerPath)));
    } catch {
      // The compiler turns a missing file into its own "file not found" diagnostic at the import that names it.
      return undefined;
    }
  },
};
