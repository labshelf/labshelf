// Adapts the WebExtension native-messaging port to the small surface the native-host clients need.
import { bx } from "./browserApi";

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
