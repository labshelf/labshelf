// The stored drawing block: a labshelf-drawing div holding a guarded TikZ picture, its PNG, the closing \fi, its SVG and its model; reads exactly that div and writes it under a 256 KB cap.
// CONTRACT: documents/contracts/qmd-items.md#drawings
import { formatDrawingModel, parseDrawingModel, type DrawingModel } from "./model.js";

export interface DrawingBlock { model: import("./model.js").DrawingModel; tikz: string; png: string; alt: string; svg: string; source: string; handEdited: boolean }

/** The most UTF-8 bytes a drawing block may take. */
const DRAWING_BLOCK_BYTES = 262144;

const FENCE = "```";
const LATEX_FENCE = "```{=latex}";
const SVG_FENCE = "```{=labshelf-svg}";
const MODEL_FENCE = "```{=labshelf-drawing}";
const CLOSE_DIV = ":::";
const FI = "\\fi";
const GUARD_OPEN = "\\makeatletter\\@ifundefined{tikzpicture}{\\iftrue}{";
const GUARD_CLOSE = "\\iffalse}\\makeatother";
const OPENER = /^::: \{\.labshelf-drawing source=([^\s{}]+)\}$/;
const IMAGE = /^!\[\]\((data:image\/png;base64,[A-Za-z0-9+/]*={0,2})\)\{fig-alt="((?:[^"\\]|\\.)*)"\}$/;

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of the UTF-8 text as lowercase hex; synchronous and free of Node APIs so it runs in every host. TRAP: not deriveTextSha256Hex, which is async (Web Crypto) while readDrawingBlock is synchronous. */
function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const length = Math.ceil((data.length + 9) / 64) * 64;
  const bytes = new Uint8Array(length);
  bytes.set(data);
  bytes[data.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(length - 8, Math.floor(data.length / 0x20000000));
  view.setUint32(length - 4, (data.length * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < length; block += 64) {
    for (let i = 0; i < 16; i += 1) { w[i] = view.getUint32(block + i * 4); }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      w[i] = w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = h[i]! + v; });
  }
  return Array.from(h, (v) => v.toString(16).padStart(8, "0")).join("");
}

/** The first 12 hex characters of the SHA-256 of the TikZ text. */
function tikzHash(tikz: string): string {
  return sha256Hex(tikz).slice(0, 12);
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function escapeAlt(alt: string): string {
  return alt.replace(/[\r\n]+/g, " ").replace(/[\\"]/g, (c) => `\\${c}`);
}

function unescapeAlt(alt: string): string {
  return alt.replace(/\\(.)/g, "$1");
}

/** Walks the div's inner lines part by part; each reader returns null when the next part is not what it expects. */
class Parts {
  private at = 0;

  constructor(private readonly lines: readonly string[]) {}

  private skipBlank(): void {
    while (this.at < this.lines.length && this.lines[this.at]!.trim() === "") { this.at += 1; }
  }

  /** The body of the raw fence opened by `open` at the next non-blank line, joined with \n. */
  fence(open: string): string | null {
    this.skipBlank();
    if (this.lines[this.at] !== open) { return null; }
    const close = this.lines.indexOf(FENCE, this.at + 1);
    if (close < 0) { return null; }
    const body = this.lines.slice(this.at + 1, close).join("\n");
    this.at = close + 1;
    return body;
  }

  /** The next non-blank line. */
  line(): string | null {
    this.skipBlank();
    const line = this.lines[this.at];
    if (line === undefined) { return null; }
    this.at += 1;
    return line;
  }

  /** True when only blank lines are left. */
  done(): boolean {
    this.skipBlank();
    return this.at === this.lines.length;
  }
}

/** Reads a drawing block: exactly one labshelf-drawing div with its five parts in order (\n or \r\n, blank lines between parts); null for anything else, an invalid model or a block over the cap. */
export function readDrawingBlock(text: string): DrawingBlock | null {
  if (utf8Bytes(text) > DRAWING_BLOCK_BYTES) { return null; }
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines.at(-1)!.trim() === "") { lines.pop(); }
  const opener = OPENER.exec(lines[0] ?? "");
  if (!opener || lines.length < 2 || lines.at(-1) !== CLOSE_DIV) { return null; }
  const parts = new Parts(lines.slice(1, -1));
  const guard = parts.fence(LATEX_FENCE);
  if (guard === null || !guard.startsWith(GUARD_OPEN) || !guard.endsWith(GUARD_CLOSE)) { return null; }
  const tikz = guard.slice(GUARD_OPEN.length, guard.length - GUARD_CLOSE.length);
  const image = IMAGE.exec(parts.line() ?? "");
  if (!image || parts.fence(LATEX_FENCE) !== FI) { return null; }
  const svg = parts.fence(SVG_FENCE);
  const json = parts.fence(MODEL_FENCE);
  if (svg === null || json === null || !parts.done()) { return null; }
  const model = parseDrawingModel(json);
  if (!model) { return null; }
  const source = opener[1]!;
  return { model, tikz, png: image[1]!, alt: unescapeAlt(image[2]!), svg, source, handEdited: source !== tikzHash(tikz) };
}

/** Writes the drawing block of the given parts with the file's line ending; null when a part would break the block or it exceeds 256 KB in UTF-8. */
export function formatDrawingBlock(parts: { model: import("./model.js").DrawingModel; tikz: string; png: string; alt: string; svg: string }, eol: string): string | null {
  const tikz = parts.tikz.replace(/\r\n?/g, "\n");
  const svg = parts.svg.replace(/\r\n?|\n/g, " ");
  const model: DrawingModel = parts.model;
  const bodies = [tikz, svg];
  if (bodies.some((body) => body.split("\n").includes(FENCE)) || !IMAGE.test(`![](${parts.png}){fig-alt=""}`)) { return null; }
  const text = [
    `::: {.labshelf-drawing source=${tikzHash(tikz)}}`,
    LATEX_FENCE, `${GUARD_OPEN}${tikz}${GUARD_CLOSE}`, FENCE,
    "",
    `![](${parts.png}){fig-alt="${escapeAlt(parts.alt)}"}`,
    "",
    LATEX_FENCE, FI, FENCE,
    "",
    SVG_FENCE, svg, FENCE,
    "",
    MODEL_FENCE, formatDrawingModel(model), FENCE,
    CLOSE_DIV,
  ].join("\n");
  const out = eol === "\n" ? text : text.replace(/\n/g, eol);
  return utf8Bytes(out) > DRAWING_BLOCK_BYTES ? null : out;
}
