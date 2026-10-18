// Reports a successful build: `built` with the PDF's SHA-256, then the PDF in `pdf` chunks.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { LocatedProblem } from "../../../latex/build/index.js";
import { PROTOCOL_VERSION, chunkBytes } from "../../index.js";

import type { HelperSend } from "../dispatch/index.js";

export async function sendBuiltPdf(id: string, pdfPath: string, problems: LocatedProblem[], send: HelperSend): Promise<void> {
  const bytes = await readFile(pdfPath);
  const pdfSha256 = createHash("sha256").update(bytes).digest("hex");
  send({ v: PROTOCOL_VERSION, id, type: "built", status: "succeeded", problems, pdfSha256 });
  for (const chunk of chunkBytes(bytes)) { send({ v: PROTOCOL_VERSION, id, type: "pdf", chunk }); }
}
