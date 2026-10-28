// Wires the LaTeX helper client of an extension page to the browser's native messaging and to a WebSocket transport
// to LabShelf Helper's session port: binary frames in the connection message format.
import {
  createNativeLatexHelper, decodeConnectionMessage, encodeConnectionMessage, HELPER_HOST_NAME, type HelperTransport, type ILatexHelper,
} from "@labshelf/core/helper";
import { formatError, type ILogger } from "@labshelf/core";
import { bx, connectBrowserNative } from "../platform";

export function createBrowserLatexHelper(logger: ILogger): ILatexHelper {
  return createNativeLatexHelper({
    logger,
    extensionVersion: bx.runtime.getManifest().version,
    origin: location.origin,
    connectNative: () => connectBrowserNative(HELPER_HOST_NAME),
    openSocket: (url) => openHelperSocket(url),
  });
}

export type HelperConnectionConstructor = new (url: string) => Pick<
  WebSocket, "binaryType" | "send" | "close" | "onopen" | "onmessage" | "onclose" | "onerror"
>;

const NO_PAYLOAD = new Uint8Array(0);

/** Resolves once the socket is open; rejects with the close reason when it closes first. */
export function openHelperSocket(url: string, Socket: HelperConnectionConstructor = globalThis.WebSocket): Promise<HelperTransport> {
  return new Promise((resolve, reject) => {
    const socket = new Socket(url);
    socket.binaryType = "arraybuffer";
    let messageListener: (message: unknown, payload: Uint8Array) => void = () => undefined;
    let closeListener: (reason: string | undefined) => void = () => undefined;
    let opened = false;
    const closeReason = (event: CloseEvent): string => event.reason || `WebSocket closed with code ${event.code}`;
    socket.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) { messageListener("a text frame", NO_PAYLOAD); return; }
      try {
        const decoded = decodeConnectionMessage(new Uint8Array(event.data));
        messageListener(decoded.envelope, decoded.payload);
      } catch (error) {
        messageListener(formatError(error), NO_PAYLOAD);
      }
    };
    socket.onclose = (event: CloseEvent) => {
      if (opened) { closeListener(closeReason(event)); } else { reject(new Error(`LabShelf Helper socket did not open: ${closeReason(event)}`)); }
    };
    socket.onopen = () => {
      opened = true;
      resolve({
        post: (message, payload) => socket.send(encodeConnectionMessage(message, payload) as BufferSource),
        onMessage: (listener) => { messageListener = listener; },
        onClose: (listener) => { closeListener = listener; },
        close: () => socket.close(),
      });
    };
  });
}
