// Provides the reader transport for a page where host and reader UI share one document.
// INVARIANT: messages are structured-cloned and delivered asynchronously, as across a VS Code webview boundary.
import type { HostToWebview, WebviewToHost } from "../../index.js";
import type { ReaderTransport } from "./session/index.js";

export interface InPageChannel {
  /** Handed to startReader. */
  transport: ReaderTransport;
  /** Host side: sends a message to the reader UI (buffered until the UI listens). */
  send(msg: HostToWebview): void;
}

/**
 * @returns a transport whose posts reach `onMessage`, plus the function the host uses to answer.
 */
export function createInPageChannel(onMessage: (msg: WebviewToHost) => void): InPageChannel {
  let sink: ((msg: unknown) => void) | null = null;
  const backlog: HostToWebview[] = [];
  const deliver = (msg: HostToWebview): void => {
    const copy = structuredClone(msg);
    setTimeout(() => sink?.(copy), 0);
  };
  return {
    transport: {
      post(msg) {
        const copy = structuredClone(msg);
        setTimeout(() => onMessage(copy), 0);
      },
      listen(fn) {
        sink = fn;
        for (const msg of backlog.splice(0)) deliver(msg);
      },
    },
    send(msg) {
      if (sink) deliver(msg);
      else backlog.push(msg);
    },
  };
}
