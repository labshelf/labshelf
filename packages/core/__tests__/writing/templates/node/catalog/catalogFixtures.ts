// Builds template catalog checkouts on disk for the validator and index tests.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { makeTempDir } from "../../../../support/tempDirs";

export const KIB = 1024;
export const PDF = "%PDF-1.5\n%%EOF\n";

export function manifestYaml(id: string, overrides: Record<string, string | undefined> = {}): string {
  const keys: Record<string, string | undefined> = {
    schema: "1", id, name: "Sample", description: "A sample template.", category: "article", format: "latex",
    engine: "pdflatex", main: "main.tex", license: "MIT", authors: "[Jane Doe]", ...overrides,
  };
  return Object.entries(keys).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n";
}

/** A minimal PNG: signature, an IHDR chunk with the given width, padded to `size` bytes. */
export function pngBytes(width: number, size = 100): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(300, 12);
  ihdr.writeUInt8(8, 16);
  ihdr.writeUInt8(2, 17);
  const head = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))]);
}

export async function put(root: string, rel: string, content: string | Uint8Array): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

/** Writes a valid template folder; `extraFiles` are added under files/ for tests that need more than main.tex. */
export async function addTemplate(root: string, id: string, overrides: Record<string, string | undefined> = {}, extraFiles: string[] = []): Promise<void> {
  const base = `templates/${id}`;
  await put(root, `${base}/template.yaml`, manifestYaml(id, overrides));
  await put(root, `${base}/files/main.tex`, `\\documentclass{article} % ${id}\n`);
  for (const file of extraFiles) { await put(root, `${base}/files/${file}`, `${file}\n`); }
  await put(root, `${base}/preview/thumbnail.png`, pngBytes(800));
  await put(root, `${base}/preview/sample.pdf`, PDF);
}

export async function catalogWith(...ids: string[]): Promise<string> {
  const root = await makeTempDir();
  for (const id of ids) { await addTemplate(root, id); }
  return root;
}
