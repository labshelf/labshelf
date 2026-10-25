// Adapts the helper's two transports, native messaging and the loopback WebSocket, to one message channel.
import { decodeConnectionMessage, encodeConnectionMessage } from "@labshelf/core/helper";
import type { NativePort } from "../../../platform";

/** A message in, a message out: `payload` carries the raw bytes that follow a socket envelope and is empty on the native port. */
export interface HelperChannel {
  post(message: object, payload?: Uint8Array): void;
  onMessage(listener: (message: unknown, payload: Uint8Array) => void): void;
  onClose(listener: (reason: string | undefined) => void): void;
  close(): void;
}

export type HelperPortFactory = () => NativePort;
export type HelperWebSocketConstructor = new (url: string) => Pick<
  WebSocket, "binaryType" | "send" | "close" | "onopen" | "onmessage" | "onclose" | "onerror"
>;

const NO_PAYLOAD = new Uint8Array(0);

export function nativeChannel(port: NativePort): HelperChannel {
  return {
    post: (message) => port.post(message),
    onMessage: (listener) => port.onMessage((frame) => listener(frame, NO_PAYLOAD)),
    onClose: (listener) => port.onDisconnect(listener),
    close: () => port.disconnect(),
  };
}

/** Resolves once the socket is open; rejects with the close reason when it closes first. */
export function openSocketChannel(url: string, Socket: HelperWebSocketConstructor): Promise<HelperChannel> {
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
        messageListener(error instanceof Error ? error.message : String(error), NO_PAYLOAD);
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
