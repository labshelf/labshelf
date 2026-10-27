// Reaches the browser: the cross-browser WebExtension API, runtime requests, downloads, the native-messaging port and page visibility.
// Call sites target Chromium and Firefox without conditionals and never touch raw `chrome.*` or `browser.*` globals.
import polyfill from "webextension-polyfill";
import type { RuntimeMessage, RuntimeResponse } from "./messages";

export const bx = polyfill;

/** Sends a typed request to the background and unwraps the reply envelope, throwing the background's error text. */
export async function sendRuntime<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

/** Saves text as a file through the browser's download dialog, for the reader's and the library page's exports. */
export async function downloadTextFile(fileName: string, text: string, mimeType: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  try {
    await bx.downloads.download({ url, filename: fileName, saveAs: true });
  } finally {
    // The download has its own copy once started; a cancelled dialog needs nothing either.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Adapts the WebExtension native-messaging port to the small surface the native-host clients need. */
export interface NativePort {
  post(frame: unknown): void;
  onMessage(listener: (frame: unknown) => void): void;
  /** `reason` is the browser's explanation for the close, when it gives one. */
  onDisconnect(listener: (reason: string | undefined) => void): void;
  disconnect(): void;
}

export function connectBrowserNative(hostName: string): NativePort {
  const port = bx.runtime.connectNative(hostName);
  return {
    post: (frame) => port.postMessage(frame),
    onMessage: (listener) => port.onMessage.addListener(listener),
    // PLATFORM: Chrome reports the close reason in runtime.lastError inside the listener; Firefox puts it on port.error.
    onDisconnect: (listener) => port.onDisconnect.addListener((closed) => listener(closed.error?.message ?? bx.runtime.lastError?.message)),
    disconnect: () => port.disconnect(),
  };
}

// PLATFORM: Chrome says "Specified native messaging host not found."; Firefox says "No such native application <name>".
const NOT_FOUND = [/native messaging host not found/i, /no such native application/i];

/** Tells whether a native-messaging failure means the native host is not installed. */
export function isHostNotFound(reason: string | undefined): boolean {
  return reason !== undefined && NOT_FOUND.some((pattern) => pattern.test(reason));
}

/**
 * Runs `onVisible` each time the page shows again, and hands every runtime broadcast to `onMessage` when given.
 * @returns a disposer that removes both listeners
 */
export function watchVisibility(options: { onVisible: () => void; onMessage?: (message: unknown) => void }): () => void {
  const { onVisible, onMessage } = options;
  const visible = (): void => { if (document.visibilityState === "visible") onVisible(); };
  // PLATFORM: Must stay synchronous and return nothing: runtime.sendMessage broadcasts popup requests to extension pages
  // too, and a listener returning a Promise would answer them with undefined.
  const message = (raw: unknown): void => { onMessage?.(raw); };
  document.addEventListener("visibilitychange", visible);
  if (onMessage) bx.runtime.onMessage.addListener(message);
  return () => {
    document.removeEventListener("visibilitychange", visible);
    if (onMessage) bx.runtime.onMessage.removeListener(message);
  };
}
