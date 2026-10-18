// Encodes and decodes the Content-Length framed JSON-RPC messages a language server speaks on stdio.

const SEPARATOR = Buffer.from("\r\n\r\n");
const CONTENT_LENGTH = /^content-length:\s*(\d+)\s*$/im;

export function encodeLspFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** Returns a function to feed stdout chunks to; each complete message reaches `onMessage`, whatever way the chunks fall. */
export function createLspFrameParser(onMessage: (message: unknown) => void, onInvalid: (reason: string) => void): (chunk: Uint8Array) => void {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      const headerEnd = pending.indexOf(SEPARATOR);
      if (headerEnd < 0) { return; }
      const length = CONTENT_LENGTH.exec(pending.subarray(0, headerEnd).toString("ascii"))?.[1];
      if (length === undefined) {
        onInvalid("frame without Content-Length");
        pending = pending.subarray(headerEnd + SEPARATOR.length);
        continue;
      }
      const bodyStart = headerEnd + SEPARATOR.length;
      const bodyEnd = bodyStart + Number(length);
      if (pending.length < bodyEnd) { return; }
      const body = pending.subarray(bodyStart, bodyEnd).toString("utf8");
      pending = pending.subarray(bodyEnd);
      try {
        onMessage(JSON.parse(body));
      } catch {
        onInvalid("frame body is not JSON");
      }
    }
  };
}
