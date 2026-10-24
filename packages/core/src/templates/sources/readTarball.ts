// Unpacks a .tar.gz archive in memory into its entries, so any runtime can read a downloaded package without a disk.
const BLOCK = 512;
// TRAP: created per call, because jsdom test environments that load this module have no TextDecoder.
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export interface TarEntry {
  /** `/`-joined, without a leading `./`. */
  path: string;
  /** A link is reported, never followed, so the caller can refuse it. */
  kind: "file" | "directory" | "link" | "other";
  bytes: Uint8Array;
}

/** Decompresses at most `maxBytes`; a larger archive throws before it fills memory. */
async function gunzip(archive: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  // slice() narrows the buffer to ArrayBuffer, which Blob requires.
  const stream = new Blob([archive.slice()]).stream().pipeThrough(new DecompressionStream("gzip"));
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) { throw new Error(`The archive unpacks to more than ${maxBytes} bytes`); }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

const text = (block: Uint8Array, start: number, length: number): string => {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return decode(end === -1 ? field : field.subarray(0, end));
};

function octal(block: Uint8Array, start: number, length: number): number {
  const value = Number.parseInt(text(block, start, length).trim() || "0", 8);
  if (!Number.isSafeInteger(value) || value < 0) { throw new Error("The archive has an unreadable entry size"); }
  return value;
}

/** The `path` record of a pax header, which overrides the next entry's name. */
function paxPath(body: Uint8Array): string | undefined {
  for (const record of decode(body).split("\n")) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match) { return match[1]; }
  }
  return undefined;
}

function kindOf(type: string): TarEntry["kind"] {
  if (type === "0" || type === "" || type === "7") { return "file"; }
  if (type === "5") { return "directory"; }
  if (type === "1" || type === "2") { return "link"; }
  return "other";
}

export async function readTarGz(archive: Uint8Array, maxBytes: number): Promise<TarEntry[]> {
  const tar = await gunzip(archive, maxBytes);
  const entries: TarEntry[] = [];
  let longName: string | undefined;
  for (let offset = 0; offset + BLOCK <= tar.length;) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) { break; }
    const size = octal(header, 124, 12);
    const type = text(header, 156, 1);
    const start = offset + BLOCK;
    if (start + size > tar.length) { throw new Error("The archive ends inside an entry"); }
    const body = tar.subarray(start, start + size);
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
    // GNU long names and pax headers carry the name of the entry that follows them.
    if (type === "L") { longName = text(body, 0, body.length); continue; }
    if (type === "x") { longName = paxPath(body) ?? longName; continue; }
    if (type === "g") { continue; }
    const prefix = text(header, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100));
    longName = undefined;
    entries.push({ path: name.replace(/^(\.\/)+/, "").replace(/\/+$/, ""), kind: kindOf(type), bytes: body });
  }
  return entries;
}
