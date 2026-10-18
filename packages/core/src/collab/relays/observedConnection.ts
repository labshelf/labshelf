// Watches the ticket requests and sockets of one relay transport, telling the selector about limits, failures and opens.
import type { RelaySocket, RelaySocketFactory } from "../transport/index.js";
import type { RelayFailure } from "./relaySelector.js";

export interface ConnectionReports {
  failure(kind: RelayFailure): void;
  connected(): void;
}

// TRAP: Cloudflare answers a Worker past its daily requests with its own error page, code 1027, not the relay's JSON.
export const isLimitRefusal = async (response: Response) =>
  response.status === 429 || (!response.ok && /\b1027\b/.test(await response.clone().text().catch(() => "")));

/** The fetch and socket factory to hand a relay transport; each reports to `reports` and otherwise behaves like `base`. */
export function observeConnection(
  base: { fetch: () => typeof fetch; socketFactory: RelaySocketFactory }, reports: ConnectionReports,
): { fetch: typeof fetch; socketFactory: RelaySocketFactory } {
  const observedFetch: typeof fetch = async (input, init) => {
    let response: Response;
    try {
      response = await base.fetch()(input, init);
    } catch (error) {
      reports.failure("error");
      throw error;
    }
    if (await isLimitRefusal(response)) { reports.failure("limit"); } else if (!response.ok) { reports.failure("error"); }
    return response;
  };
  return { fetch: observedFetch, socketFactory: (url) => observedSocket(base.socketFactory(url), reports) };
}

/** A socket that closes before it opens is a failed attempt; one that opens ends the run of failures. */
function observedSocket(socket: RelaySocket, reports: ConnectionReports): RelaySocket {
  let opened = false;
  let onopen: RelaySocket["onopen"] = null;
  let onclose: RelaySocket["onclose"] = null;
  socket.onopen = () => { opened = true; reports.connected(); onopen?.(); };
  socket.onclose = (event) => { if (!opened) { reports.failure("error"); } onclose?.(event); };
  return {
    get binaryType() { return socket.binaryType; },
    set binaryType(value) { socket.binaryType = value; },
    send: (data) => socket.send(data),
    close: () => socket.close(),
    get onopen() { return onopen; },
    set onopen(handler) { onopen = handler; },
    get onmessage() { return socket.onmessage; },
    set onmessage(handler) { socket.onmessage = handler; },
    get onclose() { return onclose; },
    set onclose(handler) { onclose = handler; },
    get onerror() { return socket.onerror; },
    set onerror(handler) { socket.onerror = handler; },
  };
}
