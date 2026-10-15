/**
 * Connects the UI to a host that runs in the same page. Delivery is synchronous, so a message posted
 * from a click handler reaches the host inside the same user gesture (a file picker opened there is allowed).
 */
import type { HostToUi, UiToHost } from "./messages.js";
import type { HostEndpoint, LibraryTransport } from "./transport.js";

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

/** Creates both ends of a synchronous in-page channel. */
export function createLoopbackTransport(): { ui: LibraryTransport; host: HostEndpoint } {
  const toHost = lane<UiToHost>();
  const toUi = lane<HostToUi>();
  return {
    ui: { post: (m) => toHost.deliver(m), subscribe: (h) => toUi.subscribe(h) },
    host: { post: (m) => toUi.deliver(m), subscribe: (h) => toHost.subscribe(h) },
  };
}
