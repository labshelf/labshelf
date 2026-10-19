/** Builds small .tar.gz archives in memory, with the header types Typst Universe packages and hostile archives use. */
import { gzipSync } from "node:zlib";

export interface TarFixtureEntry {
  name: string;
  /** "0" file, "5" directory, "1" hard link, "2" symlink, "L" GNU long name, "x" pax header. */
  type?: string;
  body?: string | Uint8Array;
  prefix?: string;
}

function header(entry: TarFixtureEntry, size: number): Uint8Array {
  const block = Buffer.alloc(512);
  block.write(entry.name.slice(0, 100), 0);
  block.write("0000644\0", 100);
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  block.write(entry.type ?? "0", 156);
  block.write("ustar  \0", 257);
  if (entry.prefix) { block.write(entry.prefix, 345); }
  return block;
}

export function tar(entries: TarFixtureEntry[]): Uint8Array<ArrayBuffer> {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const body = typeof entry.body === "string" ? Buffer.from(entry.body) : Buffer.from(entry.body ?? []);
    blocks.push(header(entry, body.length), body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(Buffer.concat(blocks));
}

export const tarGz = (entries: TarFixtureEntry[]): Uint8Array<ArrayBuffer> => new Uint8Array(gzipSync(tar(entries)));
