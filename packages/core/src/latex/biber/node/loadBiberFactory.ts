// Evaluates the emscripten factory script of biber as a CommonJS module, from source text, so a single executable can carry it as an asset.
import { createRequire } from "node:module";
import * as path from "node:path";
import { compileFunction } from "node:vm";

/** The subset of the emscripten module biber's run uses. */
export interface BiberModule {
  FS: {
    mkdirTree(folder: string): void;
    writeFile(file: string, data: Uint8Array): void;
    readFile(file: string): Uint8Array;
    analyzePath(file: string): { exists: boolean };
    chdir(folder: string): void;
  };
  callMain(args: string[]): number;
}

export interface BiberModuleOptions {
  noInitialRun: true;
  instantiateWasm(imports: object, receive: (instance: unknown) => void): object;
  locateFile(file: string): string;
  print(text: string): void;
  printErr(text: string): void;
}

export type BiberFactory = (options: BiberModuleOptions) => Promise<BiberModule>;

/** `filename` names the script in stack traces; the factory may require only Node built-ins. */
export function loadBiberFactory(source: string, filename: string): BiberFactory {
  const module = { exports: {} as unknown };
  const wrapper = compileFunction(source, ["exports", "require", "module", "__filename", "__dirname"], { filename });
  // PLATFORM: inside a single executable `require` reaches only built-ins, which is all the factory loads.
  wrapper(module.exports, createRequire(filename), module, filename, path.dirname(filename));
  if (typeof module.exports !== "function") { throw new Error(`${filename} does not export the biber factory`); }
  return module.exports as BiberFactory;
}
