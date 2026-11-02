// Reaches the browser: the cross-browser WebExtension API, runtime requests, downloads, the native-messaging port and page visibility.
// Call sites target Chromium and Firefox without conditionals and never touch raw `chrome.*` or `browser.*` globals.
import polyfill from "webextension-polyfill";
import type { NativeMessagePort } from "@labshelf/core";
import type { RuntimeMessage, RuntimeResponse } from "./messages";

export const bx = polyfill;

/** Sends a typed request to the background and unwraps the reply envelope, throwing the background's error text. */
export async function sendRuntime<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

/** Saves bytes as a file through the browser's download dialog, for the exports of the reader, the library page and the decks. */
export async function downloadBytes(bytes: Uint8Array, filename: string, mime: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    await bx.downloads.download({ url, filename, saveAs: true });
  } finally {
    // The download has its own copy once started; a cancelled dialog needs nothing either.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Saves text as a file through the browser's download dialog. */
export function downloadTextFile(fileName: string, text: string, mimeType: string): Promise<void> {
  return downloadBytes(new TextEncoder().encode(text), fileName, mimeType);
}

/** Opens `text` with `mime` in a new tab as a blob URL, with `#<fragment>` when given; the URL is revoked after 60 s. */
export async function openBlobTab(text: string, mime: string, fragment?: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  try {
    await bx.tabs.create({ url: fragment === undefined ? url : `${url}#${fragment}` });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Adapts the WebExtension native-messaging port to the core port the native-host clients need. */
export function connectBrowserNative(hostName: string): NativeMessagePort {
  const port = bx.runtime.connectNative(hostName);
  return {
    post: (frame) => port.postMessage(frame),
    onMessage: (listener) => port.onMessage.addListener(listener),
    // PLATFORM: Chrome reports the close reason in runtime.lastError inside the listener; Firefox puts it on port.error.
    onDisconnect: (listener) => port.onDisconnect.addListener((closed) => listener(closed.error?.message ?? bx.runtime.lastError?.message)),
    disconnect: () => port.disconnect(),
  };
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
