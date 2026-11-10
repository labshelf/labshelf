// Compiles Typst in the browser with core's WASM compiler: the pinned wasm from jsDelivr, the default fonts fetched once, no packages.
import { deriveTypstProblems, openTypstSession, TYPST_FONT_BASE_URL, TYPST_FONTS, TYPST_VERSION, type TypstFontFile, type TypstSession } from "@labshelf/core/typst";

import type { BrowserCompileInput, BrowserCompileResult } from "./compileTypes.js";
import { createInputFileAccess, deriveTypstTarget, findPackageImports, toProjectPath, type TypstInputs } from "./typstInputs.js";

// INVARIANT: the @myriaddreamin/typst-ts-web-compiler version core depends on (see TYPST_VERSION); the checksum is its pkg/ wasm.
// The wasm (28 MB) comes from jsDelivr because the website's static assets refuse files over 25 MiB.
const TYPST_WASM_URL = "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0/pkg/typst_ts_web_compiler_bg.wasm";
const TYPST_WASM_SHA256 = "1fc968438a672366dfec39c96c842c26ed29caff4eb1bcaab19a6c60867de5fd";

const FONT_CACHE = `labshelf-typst-fonts-${TYPST_VERSION}`;

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function fetchFont(font: TypstFontFile, cache: Cache | undefined): Promise<Uint8Array> {
  const url = `${TYPST_FONT_BASE_URL}${font.file}`;
  const cached = await cache?.match(url);
  const response = cached ?? await fetch(url);
  if (!response.ok) { throw new Error(`The Typst font ${font.file} could not be downloaded (HTTP ${response.status}).`); }
  const bytes = await response.clone().arrayBuffer();
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== font.sha256) {
    if (cached) { await cache?.delete(url); }
    throw new Error(`The Typst font ${font.file} does not match its pinned checksum.`);
  }
  if (!cached) { await cache?.put(url, response).catch(() => undefined); }
  return new Uint8Array(bytes);
}

async function loadFonts(): Promise<Uint8Array[]> {
  const cache = typeof caches === "undefined" ? undefined : await caches.open(FONT_CACHE).catch(() => undefined);
  return Promise.all(TYPST_FONTS.map((font) => fetchFont(font, cache)));
}

async function loadWasm(): Promise<Uint8Array> {
  const response = await fetch(TYPST_WASM_URL);
  if (!response.ok) { throw new Error(`The Typst compiler could not be downloaded (HTTP ${response.status}).`); }
  const bytes = await response.arrayBuffer();
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== TYPST_WASM_SHA256) { throw new Error("The downloaded Typst compiler does not match its pinned checksum."); }
  return new Uint8Array(bytes);
}

let inputs: TypstInputs = { files: new Map(), generation: 0 };
let session: Promise<TypstSession> | undefined;
let queue: Promise<unknown> = Promise.resolve();

function openSession(): Promise<TypstSession> {
  session ??= Promise.all([loadWasm(), loadFonts()])
    .then(([wasm, fonts]) => openTypstSession({ wasm, fonts, files: createInputFileAccess(() => inputs), packages: { resolve: () => undefined } }))
    .catch((error: unknown) => { session = undefined; throw error; });
  return session;
}

async function compileNow(input: BrowserCompileInput, signal: AbortSignal | undefined): Promise<BrowserCompileResult> {
  signal?.throwIfAborted();
  const packages = findPackageImports(input.files);
  if (packages.length > 0) { return { diagnostics: packages }; }
  let typst: TypstSession;
  try { typst = await openSession(); }
  catch (error) { return { diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : String(error) }] }; }
  signal?.throwIfAborted();
  inputs = { files: input.files, generation: inputs.generation + 1 };
  const result = await typst.compile({ ...deriveTypstTarget(input.main), sources: new Map() });
  signal?.throwIfAborted();
  const diagnostics = deriveTypstProblems(result.diagnostics, input.main, toProjectPath)
    .map(({ severity, message, file, line }) => ({ severity: severity === "error" ? "error" as const : "warning" as const, message, file, ...(line === undefined ? {} : { line }) }));
  return result.pdf ? { pdf: result.pdf, diagnostics } : { diagnostics };
}

/** Compiles one Typst project after any compile already running; aborting `signal` rejects with its reason and drops the PDF. */
export function compileTypst(input: BrowserCompileInput, signal?: AbortSignal): Promise<BrowserCompileResult> {
  const run = queue.then(() => compileNow(input, signal));
  queue = run.catch(() => undefined);
  return run;
}
