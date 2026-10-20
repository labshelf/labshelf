// Declares the port through which a host hands over the biber WASM module: its manifest, its factory source, its WASM and its preloaded Perl tree.

export interface BiberManifest {
  /** The biber release the module was built from. */
  biber: string;
  /** The `.bcf` format version this biber reads; a control file of another version goes to the TeX's own biber. */
  bcfVersion: string;
  /** sha256 of each file, by file name. */
  files: Record<string, string>;
}

export interface BiberWasmAssets {
  manifest: BiberManifest;
  /** The emscripten factory script (`biber.js`), a CommonJS module. */
  factorySource(): Promise<string>;
  wasm(): Promise<Uint8Array>;
  /** A file on disk holding `biber.data`, which the module reads itself. */
  dataFile(): Promise<string>;
}

export const BIBER_ASSET_FILES = { factory: "biber.js", wasm: "biber.wasm", data: "biber.data", manifest: "manifest.json" } as const;

export function parseBiberManifest(text: string): BiberManifest {
  const value = JSON.parse(text) as Partial<BiberManifest>;
  if (typeof value.biber !== "string" || typeof value.bcfVersion !== "string" || typeof value.files !== "object" || value.files === null) {
    throw new Error(`biber manifest lacks biber, bcfVersion or files: ${text.slice(0, 200)}`);
  }
  return { biber: value.biber, bcfVersion: value.bcfVersion, files: value.files };
}
