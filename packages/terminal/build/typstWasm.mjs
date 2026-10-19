// Locates typst.ts's compiler WASM, which core depends on, for the builds that ship it.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TYPST_WASM_FILE = "typst_ts_web_compiler_bg.wasm";

export const typstWasmPath = () =>
  createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../../core/package.json")).resolve("@myriaddreamin/typst-ts-web-compiler/wasm");
