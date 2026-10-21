// Declares the port a share connection starts its app's disk mirror through, and what the connection reports of it.
import type { LeaseHolder } from "../ownership/index.js";
import type { CollabStore } from "../state/index.js";
import type { BlobExchange, ShareSession } from "../sync/index.js";

export interface ConnectionMirror {
  /** Reports a changed path relative to the project folder; also call it when an editor lets a path go. */
  changed(path: string): void;
  idle(): Promise<void>;
  close(): Promise<void>;
}

/**
 * `busy` while another mirror owns the folder; the connection then runs without one.
 * `running` resolves with the mirror once the folder frees, or undefined when the connection closes first.
 */
export type MirrorStart =
  | { kind: "running"; mirror: ConnectionMirror }
  | { kind: "busy"; holder: LeaseHolder | "tab"; running?: Promise<ConnectionMirror | undefined> };

export interface MirrorInput {
  folder: string;
  session: ShareSession;
  blobs: BlobExchange;
  store: CollabStore;
  /** Aborts when the connection closes; a mirror still waiting for the folder then gives up. */
  signal: AbortSignal;
  /** Called once when the mirror stops by itself; the share docs keep every edit, only the disk stops following them. */
  onStopped(reason: string): void;
}

export type MirrorFactory = (input: MirrorInput) => Promise<MirrorStart>;

export type MirrorState =
  | { kind: "running" }
  | { kind: "busy"; holder: LeaseHolder | "tab" }
  | { kind: "stopped"; reason: string };
