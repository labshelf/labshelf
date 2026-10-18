// Reports a successful build: `built` with the PDF's SHA-256, then `pages` with the one-page PDFs that changed since the last send.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { LocatedProblem } from "../../../latex/build/index.js";
import { MAX_SOCKET_MESSAGE_BYTES, PROTOCOL_VERSION, type ChangedPage } from "../../index.js";

import type { HelperSend } from "../dispatch/index.js";
import { diffPages } from "../pages/index.js";
import { HelperProjectError } from "../projects/index.js";

/** The hashes of the pages last sent for one project; the next `pages` carries only the pages that differ. */
export interface SentPages { hashes: string[] }

// The socket message is a 4-byte length, the JSON envelope, then the payload (CONTRACT: documents/contracts/helper.md#limits).
const LENGTH_PREFIX_BYTES = 4;

/** @throws limit when the changed pages would not fit one socket message */
export async function sendPages(id: string, pdfPath: string, problems: LocatedProblem[], sent: SentPages, send: HelperSend): Promise<void> {
  const bytes = await readFile(pdfPath);
  const pdfSha256 = createHash("sha256").update(bytes).digest("hex");
  const diff = await diffPages(sent.hashes, bytes);
  let offset = 0;
  const changed = diff.changed.map(({ index, bytes: page }): ChangedPage => {
    const entry = { index, offset, length: page.length };
    offset += page.length;
    return entry;
  });
  const pages = { v: PROTOCOL_VERSION, id, type: "pages", pdfSha256, pageCount: diff.pageCount, changed } as const;
  const messageBytes = LENGTH_PREFIX_BYTES + Buffer.byteLength(JSON.stringify(pages)) + offset;
  if (messageBytes > MAX_SOCKET_MESSAGE_BYTES) {
    throw new HelperProjectError("limit", `The changed pages take ${messageBytes} bytes, over the ${MAX_SOCKET_MESSAGE_BYTES / (1024 * 1024)} MiB message limit`);
  }
  send({ v: PROTOCOL_VERSION, id, type: "built", status: "succeeded", problems, pdfSha256 });
  send(pages, Buffer.concat(diff.changed.map((page) => page.bytes)));
  sent.hashes = diff.hashes;
}
