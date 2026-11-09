/** Fetches a paper's arXiv e-print once, keeps the raw bytes in a cache and unpacks them into the text files of its TeX source. */
import { gunzip, readTar, type TarEntry } from "../encoding/index.js";
import type { FetchLike, ILogger } from "../ports/index.js";

const MODULE = "equations/arxivSource";

/** Where the cached e-prints live, one file per arXiv id; scratch the apps rebuild. */
export const EPRINT_CACHE_DIR = ".research/sources/arxiv";

// Well above any paper's source; it only stops a hostile archive from filling memory.
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
const TEXT_FILE = /\.(?:tex|sty|cls|bbl|def)$/i;
const GZIP_MAGIC = [0x1f, 0x8b];
const USTAR_OFFSET = 257;
const PDF_MAGIC = "%PDF";

export type EprintFiles = { kind: 'tex'; files: Map<string, string> } | { kind: 'none'; why: 'pdf' | 'empty' | 'unreadable' }

export interface EprintCache { read(arxivId: string): Promise<Uint8Array | undefined>; write(arxivId: string, bytes: Uint8Array): Promise<void> }

const startsWith = (bytes: Uint8Array, at: number, text: string): boolean =>
  bytes.length >= at + text.length && [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));

/** UTF-8 when the bytes are valid UTF-8, else Latin-1, which older papers use. */
function decodeText(bytes: Uint8Array): string {
  try {
    // TRAP: created per call, because jsdom test environments that load this module have no TextDecoder.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let text = "";
    for (let i = 0; i < bytes.length; i += 8192) { text += String.fromCharCode(...bytes.subarray(i, i + 8192)); }
    return text;
  }
}

function textFiles(entries: TarEntry[]): EprintFiles {
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === "link") { return { kind: "none", why: "unreadable" }; }
    if (entry.kind === "file" && TEXT_FILE.test(entry.path)) { files.set(entry.path, decodeText(entry.bytes)); }
  }
  return files.size === 0 ? { kind: "none", why: "empty" } : { kind: "tex", files };
}

/** Unpacks e-print bytes (a tar.gz, a gzipped or plain TeX file, a tar or a PDF) into text files; bad bytes give `none`, never a throw. */
export async function unpackEprint(bytes: Uint8Array): Promise<EprintFiles> {
  try {
    let data = bytes;
    if (startsWith(data, 0, String.fromCharCode(...GZIP_MAGIC))) { data = await gunzip(data, MAX_UNPACKED_BYTES); }
    if (data.length > MAX_UNPACKED_BYTES) { return { kind: "none", why: "unreadable" }; }
    if (startsWith(data, USTAR_OFFSET, "ustar")) { return textFiles(readTar(data)); }
    if (startsWith(data, 0, PDF_MAGIC)) { return { kind: "none", why: "pdf" }; }
    return data.length === 0 ? { kind: "none", why: "empty" } : { kind: "tex", files: new Map([["main.tex", decodeText(data)]]) };
  } catch {
    return { kind: "none", why: "unreadable" };
  }
}

/** The unpacked e-print of `arxivId`: from the cache when it holds it, else downloaded once and cached as raw bytes. A failed download throws and caches nothing. */
export async function loadEprint(arxivId: string, env: { fetch: FetchLike; cache: EprintCache; logger: ILogger; headers?: Record<string, string> }, signal?: AbortSignal): Promise<EprintFiles> {
  const cached = await env.cache.read(arxivId);
  if (cached !== undefined) { return unpackEprint(cached); }
  // Called as a bare function: a host's fetch throws when called as a method of another object.
  const { fetch } = env;
  const url = `https://arxiv.org/e-print/${arxivId}`;
  const response = await fetch(url, { ...(signal ? { signal } : {}), ...(env.headers ? { headers: env.headers } : {}) });
  if (!response.ok) { throw new Error(`arXiv answered ${response.status} for the e-print of ${arxivId}`); }
  const bytes = new Uint8Array(await response.arrayBuffer());
  void env.logger.log("INFO", MODULE, "Downloaded an arXiv e-print", { arxivId, bytes: bytes.length });
  await env.cache.write(arxivId, bytes);
  return unpackEprint(bytes);
}
