/** Reads a template's thumbnail and sample from its preview folder and checks them against the catalog limits. */
// CONTRACT: documents/contracts/templates.md#manifest

import * as fs from "node:fs";
import * as path from "node:path";

import { SAMPLE_MAX_BYTES, THUMBNAIL_MAX_BYTES, THUMBNAIL_MAX_WIDTH, THUMBNAIL_MIN_WIDTH } from "./catalogLimits.js";
import { readPngWidth } from "./pngWidth.js";

export type Previews = { thumbnail: Uint8Array; sample: Uint8Array };
type Read<T> = { value: T } | { problem: string };

/** A regular file's bytes, or the reason it cannot be used; a symbolic link is refused. */
async function readRegularFile(folder: string, name: string, maxBytes: number): Promise<Read<Uint8Array>> {
  const file = path.join(folder, name);
  const stat = await fs.promises.lstat(file).catch(() => undefined);
  if (stat === undefined) { return { problem: `${name} is missing` }; }
  if (!stat.isFile()) { return { problem: `${name} is not a regular file` }; }
  if (stat.size > maxBytes) { return { problem: `${name} is over ${maxBytes} bytes` }; }
  return { value: new Uint8Array(await fs.promises.readFile(file)) };
}

function thumbnailProblem(bytes: Uint8Array): string | undefined {
  const width = readPngWidth(bytes);
  if (width === undefined) { return "thumbnail.png is not a PNG"; }
  const inRange = width >= THUMBNAIL_MIN_WIDTH && width <= THUMBNAIL_MAX_WIDTH;
  return inRange ? undefined : `thumbnail.png is ${width} pixels wide, not ${THUMBNAIL_MIN_WIDTH} to ${THUMBNAIL_MAX_WIDTH}`;
}

/** The two preview files, or a reason naming the one that fails. */
export async function readPreviews(previewFolder: string): Promise<Read<Previews>> {
  const thumbnail = await readRegularFile(previewFolder, "thumbnail.png", THUMBNAIL_MAX_BYTES);
  if ("problem" in thumbnail) { return { problem: `thumbnail: ${thumbnail.problem}` }; }
  const problem = thumbnailProblem(thumbnail.value);
  if (problem !== undefined) { return { problem: `thumbnail: ${problem}` }; }
  const sample = await readRegularFile(previewFolder, "sample.pdf", SAMPLE_MAX_BYTES);
  if ("problem" in sample) { return { problem: `sample: ${sample.problem}` }; }
  const isPdf = new TextDecoder("latin1").decode(sample.value.subarray(0, 5)) === "%PDF-";
  return isPdf ? { value: { thumbnail: thumbnail.value, sample: sample.value } } : { problem: "sample: sample.pdf is not a PDF" };
}
