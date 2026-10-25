// Declares the WebSocket a relay transport opens, so tests can inject one; the default is the runtime's global WebSocket.

/** The part of the WebSocket API the relay transport uses. */
export interface RelayConnectionPort {
  binaryType: string;
  send(data: Uint8Array): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type RelayConnectionPortFactory = (url: string) => RelayConnectionPort;

// PLATFORM: browsers and Node 22 and later have a global WebSocket; its handler types are narrower than RelayConnectionPort's.
export const createGlobalRelayConnection: RelayConnectionPortFactory = (url) => new WebSocket(url) as unknown as RelayConnectionPort;

/** The socket URL of a share on a relay: its `https:` origin as `wss:`, then the project path and the ticket. */
export function deriveRelayConnectionUrl(relayUrl: string, shareId: string, ticket: string): string {
  const base = relayUrl.replace(/\/+$/, "").replace(/^http/, "ws");
  return `${base}/project/${shareId}?ticket=${encodeURIComponent(ticket)}`;
}

/** The bytes of a binary message; undefined for a text message, which the protocol never sends. */
export function extractMessageBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) { return data; }
  if (data instanceof ArrayBuffer) { return new Uint8Array(data); }
  return undefined;
}
