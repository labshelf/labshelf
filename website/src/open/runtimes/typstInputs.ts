// The pure side of compiling Typst in the browser: the compiler's file access over the input map, and the package imports it cannot serve.
import type { BrowserDiagnostic } from "./compileTypes.js";

/** The compiler path of the project root; input paths are relative to it. */
const TYPST_ROOT = "/project";

/** @returns the compiler's root and main paths for a project-relative main file. */
export function deriveTypstTarget(main: string): { root: string; main: string } {
  return { root: TYPST_ROOT, main: `${TYPST_ROOT}/${main}` };
}

/** The inputs of the compile running now; replaced before each compile. */
export interface TypstInputs { files: ReadonlyMap<string, Uint8Array>; generation: number }

const relativeOf = (path: string): string | undefined =>
  path.startsWith(`${TYPST_ROOT}/`) ? path.slice(TYPST_ROOT.length + 1) : undefined;

/** @returns the project path of a compiler path, or the compiler path itself when it is outside the project. */
export function toProjectPath(compilerPath: string): string {
  return relativeOf(compilerPath) ?? compilerPath.replace(/^\/+/, "");
}

/** Core's TypstFileAccess, which typst.ts passes on; spelled out so the Jest build needs no `@labshelf/core/typst` mapping. */
export interface InputFileAccess {
  getMTime(path: string): Date | undefined;
  isFile(path: string): boolean | undefined;
  getRealPath(path: string): string;
  readAll(path: string): Uint8Array | undefined;
}

/**
 * @returns synchronous file access over whatever `current()` holds; every file's modification time is the compile's generation,
 * so a reused compiler reads each file again on every compile.
 */
export function createInputFileAccess(current: () => TypstInputs): InputFileAccess {
  const lookup = (path: string): Uint8Array | undefined => {
    const relative = relativeOf(path);
    return relative === undefined ? undefined : current().files.get(relative);
  };
  const isFolder = (path: string): boolean => {
    const relative = relativeOf(`${path.replace(/\/+$/, "")}/`);
    if (relative === undefined) { return path.replace(/\/+$/, "") === TYPST_ROOT; }
    return [...current().files.keys()].some((file) => file.startsWith(relative));
  };
  return {
    getMTime: (path) => lookup(path) || isFolder(path) ? new Date(current().generation * 1000) : undefined,
    isFile: (path) => lookup(path) ? true : isFolder(path) ? false : undefined,
    getRealPath: (path) => path,
    readAll: (path) => lookup(path),
  };
}

const PACKAGE_SPEC = /"(@[a-z0-9_-]+\/[a-z0-9_-]+:[0-9][0-9A-Za-z.+-]*)"/gi;

/** @returns one error per `@namespace/name:version` package a `.typ` input names, at its line; the browser has no package registry. */
export function findPackageImports(files: ReadonlyMap<string, Uint8Array>): BrowserDiagnostic[] {
  const decoder = new TextDecoder();
  const found: BrowserDiagnostic[] = [];
  for (const [file, bytes] of files) {
    if (!file.endsWith(".typ")) { continue; }
    decoder.decode(bytes).split("\n").forEach((line, index) => {
      if (/^\s*\/\//.test(line)) { return; }
      for (const match of line.matchAll(PACKAGE_SPEC)) {
        found.push({ severity: "error", message: `Typst packages are not available in the browser yet: ${match[1]}`, file, line: index + 1 });
      }
    });
  }
  return found;
}
