// Locates biber's WASM build (biber.js, biber.wasm, biber.data, manifest.json) for the builds that ship it.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BIBER_WASM_FILES = ["biber.js", "biber.wasm", "biber.data", "manifest.json"];

/** `BIBER_WASM_DIR` points at another copy; undefined when no build exists, and the apps keep the TeX's own biber. */
export function biberWasmDir() {
  const dir = process.env.BIBER_WASM_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../tools/biber-wasm/dist");
  return existsSync(join(dir, "manifest.json")) ? dir : undefined;
}
