// Requests PNG thumbnails from the connected browser without bundling a renderer in the helper.
import { PROTOCOL_VERSION } from "../../index.js";
import type { HelperHandler, HelperSend } from "../handlers/index.js";

export function createPreviewRenderer() {
  const pending = new Map<string, { resolve(png: Uint8Array): void; reject(error: Error): void }>();
  const receive: HelperHandler = async (message, _send, payload) => {
    if (message.type !== "templateThumbnail") throw new Error("Expected templateThumbnail");
    const request = pending.get(message.requestId);
    if (!request) throw new Error("No publication is waiting for this thumbnail");
    if (message.error) request.reject(new Error(`Rendering the thumbnail failed: ${message.error}`));
    else if (!payload?.length || payload.length > 512 * 1024) request.reject(new Error("The thumbnail must be a PNG at most 512 KiB"));
    else request.resolve(payload);
  };
  const render = async (id: string, send: HelperSend, pdf: Uint8Array): Promise<Uint8Array> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        timeout = setTimeout(() => reject(new Error("The browser did not render the template thumbnail within 60 seconds")), 60_000);
        send({ v: PROTOCOL_VERSION, id, type: "templatePreview" }, pdf);
      });
    } finally {
      clearTimeout(timeout);
      pending.delete(id);
    }
  };
  return { render, receive, dispose: () => { for (const request of pending.values()) request.reject(new Error("Helper connection closed")); } };
}
