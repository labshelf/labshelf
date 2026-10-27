// Declares the two ends of the library UI channel and connects them in one page with synchronous delivery.
import type { HostToUi, UiToHost } from "./messages.js";

export interface MessageEnd<Out, In> {
  post(message: Out): void;
  /** Starts listening; returns the function that stops it. */
  subscribe(handler: (message: In) => void): () => void;
}

/** The UI side of the channel. */
export type LibraryTransport = MessageEnd<UiToHost, HostToUi>;

/** The host side of the channel. */
export type HostEndpoint = MessageEnd<HostToUi, UiToHost>;

interface Lane<T> {
  deliver(message: T): void;
  subscribe(handler: (message: T) => void): () => void;
}

// Messages posted before the other side subscribes wait in order instead of being lost.
function lane<T>(): Lane<T> {
  const handlers = new Set<(message: T) => void>();
  const pending: T[] = [];
  return {
    deliver(message) {
      if (handlers.size === 0) { pending.push(message); return; }
      for (const handler of [...handlers]) handler(message);
    },
    subscribe(handler) {
      handlers.add(handler);
      for (const message of pending.splice(0)) handler(message);
      return () => { handlers.delete(handler); };
    },
  };
}

/** Creates both ends of a synchronous in-page channel; the message types default to the library UI protocol. */
export function createLoopbackTransport<ToHost = UiToHost, ToUi = HostToUi>(): { ui: MessageEnd<ToHost, ToUi>; host: MessageEnd<ToUi, ToHost> } {
  const toHost = lane<ToHost>();
  const toUi = lane<ToUi>();
  return {
    ui: { post: (m) => toHost.deliver(m), subscribe: (h) => toUi.subscribe(h) },
    host: { post: (m) => toUi.deliver(m), subscribe: (h) => toHost.subscribe(h) },
  };
}
