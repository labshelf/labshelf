// Declares the port a share session sends encrypted frames through: a WebRTC mesh, a relay socket or a test fake.

/** A peer as the transport names it; stable for one connection, new after a reconnect. */
export type PeerId = string;

export interface PeerTransport {
  /** The peers connected right now. */
  readonly peers: readonly PeerId[];
  /** Sends one frame to one peer, or to every connected peer when `to` is "all". */
  send(to: PeerId | "all", bytes: Uint8Array): void;
  onMessage(listener: (from: PeerId, bytes: Uint8Array) => void): () => void;
  onPeerJoin(listener: (peer: PeerId) => void): () => void;
  onPeerLeave(listener: (peer: PeerId) => void): () => void;
  close(): Promise<void>;
}
