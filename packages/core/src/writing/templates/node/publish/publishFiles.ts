// Lays out the files a catalog submission carries: template.yaml, the project's files, the thumbnail and the sample PDF.
import { promises as fs } from "node:fs";

import { serializeTemplateManifest, type TemplateManifest } from "../../manifest/index.js";
import type { FoundFile } from "../walkFolder.js";

export interface PublishFile {
  /** Relative to the template's folder in the catalog. */
  path: string;
  bytes: Uint8Array;
}

/** @param projectFiles the files that passed the checks, laid out under `files/` */
export async function layOutPublishFiles(
  manifest: TemplateManifest,
  projectFiles: readonly FoundFile[],
  thumbnail: Uint8Array,
  sample: Uint8Array,
): Promise<PublishFile[]> {
  const files: PublishFile[] = [{ path: "template.yaml", bytes: new TextEncoder().encode(serializeTemplateManifest(manifest)) }];
  for (const file of projectFiles) {
    files.push({ path: `files/${file.path}`, bytes: new Uint8Array(await fs.readFile(file.absolute)) });
  }
  files.push({ path: "preview/thumbnail.png", bytes: thumbnail }, { path: "preview/sample.pdf", bytes: sample });
  return files;
}
