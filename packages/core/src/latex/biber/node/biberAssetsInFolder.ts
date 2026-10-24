// Reads biber's WASM assets from a folder, where the apps' builds copy them beside the helper script.
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { BIBER_ASSET_FILES, parseBiberManifest, type BiberWasmAssets } from "../biberAssets.js";

/** Undefined when the folder holds no manifest: the build shipped without biber's WASM. */
export function biberAssetsInFolder(folder: string): BiberWasmAssets | undefined {
  const manifestFile = path.join(folder, BIBER_ASSET_FILES.manifest);
  if (!existsSync(manifestFile)) { return undefined; }
  return {
    manifest: parseBiberManifest(readFileSync(manifestFile, "utf8")),
    factorySource: () => readFile(path.join(folder, BIBER_ASSET_FILES.factory), "utf8"),
    wasm: async () => new Uint8Array(await readFile(path.join(folder, BIBER_ASSET_FILES.wasm))),
    dataFile: () => Promise.resolve(path.join(folder, BIBER_ASSET_FILES.data)),
  };
}
