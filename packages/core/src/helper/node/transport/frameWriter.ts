// Writes helper-to-page messages as native-messaging frames and refuses any the browser would drop.
// CONTRACT: documents/contracts/helper.md#transport
import * as os from "node:os";

import type { ILogger } from "../../../ports/index.js";
import type { ToPageMessage } from "../../index.js";

/** The browser closes the host when a frame from it exceeds 1 MB. */
export const MAX_OUTGOING_FRAME_BYTES = 1024 * 1024;
const LOG_MODULE = "helper-stdio";

export interface FrameOutput { write(chunk: Buffer): unknown }

function encode(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  if (os.endianness() === "LE") { header.writeUInt32LE(payload.length); } else { header.writeUInt32BE(payload.length); }
  return Buffer.concat([header, payload]);
}

/**
 * Returns the function handlers use to answer the page. An oversize message is logged and replaced by a `limit` error
 * with the same id, so the page does not wait for a reply that cannot arrive.
 */
export function createFrameWriter(output: FrameOutput, logger: ILogger): (message: ToPageMessage) => void {
  return (message) => {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    if (payload.length <= MAX_OUTGOING_FRAME_BYTES) {
      output.write(encode(payload));
      return;
    }
    void logger.log("ERROR", LOG_MODULE, "Refused an outgoing frame over the 1 MB limit", { type: message.type, id: message.id, bytes: payload.length });
    const refusal: ToPageMessage = { v: message.v, id: message.id, type: "error", code: "limit", message: `Reply of ${payload.length} bytes exceeds the 1 MB frame limit` };
    output.write(encode(Buffer.from(JSON.stringify(refusal), "utf8")));
  };
}
