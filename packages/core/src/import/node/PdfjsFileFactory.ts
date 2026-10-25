/** Reads pdf.js CMaps, standard fonts and wasm from disk, for hosts pdf.js does not recognise as Node. */
import { readFile } from "node:fs/promises";

// Mirrors pdf.js' BaseBinaryDataFactory, which it does not export.
export class PdfjsFileFactory {
  private readonly roots: Record<string, string | null>;

  constructor(options: { cMapUrl?: string | null; standardFontDataUrl?: string | null; wasmUrl?: string | null }) {
    this.roots = {
      cMapUrl: options.cMapUrl ?? null,
      standardFontDataUrl: options.standardFontDataUrl ?? null,
      wasmUrl: options.wasmUrl ?? null,
    };
  }

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const root = this.roots[kind];
    if (!root) {
      throw new Error(`Ensure that the \`${kind}\` API parameter is provided.`);
    }
    return new Uint8Array(await readFile(`${root}${filename}`));
  }
}
