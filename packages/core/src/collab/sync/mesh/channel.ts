// Declares the mesh a share session runs on and the channels each message kind travels through.
import type { WebCryptoKey } from "../../crypto/index.js";
import type { PeerId } from "../../transport/index.js";

export type SessionStatus = "open" | "closed";

export interface ChannelSpec {
  /** Envelope kind byte; extensions use EXTENSION_KIND_MIN and above. */
  kind: number;
  /** Payload kind bound into the frame's additional data. */
  name: string;
  key: WebCryptoKey;
  /** A reliable message is numbered, acked and resent until acked. */
  reliable: boolean;
  onMessage(from: PeerId, docKey: string, payload: Uint8Array): void;
}

export interface Channel {
  /** Sends to one connected peer or to all of them. Failures are logged, never thrown. */
  send(to: PeerId | "all", docKey: string, payload: Uint8Array): Promise<void>;
}

export interface SecureMesh {
  readonly peers: readonly PeerId[];
  onPeer(listener: (peer: PeerId, joined: boolean) => void): () => void;
  readonly status: SessionStatus;
  onStatus(listener: (status: SessionStatus) => void): () => void;
  channel(spec: ChannelSpec): Channel;
  close(): Promise<void>;
}
