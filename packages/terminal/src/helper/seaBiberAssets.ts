// Reads biber's WASM assets from the single executable, writing its Perl tree once to a content-addressed file the module can read.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { getAsset } from "node:sea";

import { BIBER_ASSET_FILES, parseBiberManifest, type BiberWasmAssets } from "@labshelf/core/helper/node";

// The SEA asset names `build/sea.mjs` packs biber's files under.
const asset = (file: string): string => `biber-wasm/${file}`;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Undefined when the executable was built without biber's WASM. */
function manifestAsset(): string | undefined {
  try {
    return getAsset(asset(BIBER_ASSET_FILES.manifest), "utf8");
  } catch {
    return undefined;
  }
}

// PLATFORM: emscripten reads its preloaded package from a file path in Node, so the asset is materialised once per content hash.
async function cachedDataFile(dataDir: string, expected: string): Promise<string> {
  const file = path.join(dataDir, "biber-wasm", `biber-${expected}.data`);
  const current = await fs.readFile(file).catch(() => undefined);
  if (current && sha256(current) === expected) { return file; }
  const bytes = new Uint8Array(getAsset(asset(BIBER_ASSET_FILES.data)));
  if (sha256(bytes) !== expected) { throw new Error(`The embedded ${BIBER_ASSET_FILES.data} does not match its manifest hash`); }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const partial = `${file}.${process.pid}.partial`;
  await fs.writeFile(partial, bytes, { mode: 0o600 });
  await fs.rename(partial, file);
  return file;
}

export function seaBiberAssets(dataDir: string): BiberWasmAssets | undefined {
  const text = manifestAsset();
  if (text === undefined) { return undefined; }
  const manifest = parseBiberManifest(text);
  const dataHash = manifest.files[BIBER_ASSET_FILES.data];
  return {
    manifest,
    factorySource: () => Promise.resolve(getAsset(asset(BIBER_ASSET_FILES.factory), "utf8")),
    // PLATFORM: getAsset returns a view of the executable's memory; slice copies it before the module takes it.
    wasm: () => Promise.resolve(new Uint8Array(getAsset(asset(BIBER_ASSET_FILES.wasm)).slice(0))),
    dataFile: () => {
      if (dataHash === undefined) { return Promise.reject(new Error(`The biber manifest has no hash for ${BIBER_ASSET_FILES.data}`)); }
      return cachedDataFile(dataDir, dataHash);
    },
  };
}
