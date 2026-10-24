// Declares the socket messages between a client and the relay, their type bytes and their limits.

// CONTRACT: documents/contracts/relay.md#socket-messages
export const MAX_RELAY_MESSAGE_BYTES = 1024 * 1024;

export const CLIENT_MESSAGE_TYPE = { put: 1, since: 2, snapshot: 3, forward: 4 } as const;

export const SERVER_MESSAGE_TYPE = {
  accepted: 16, stored: 17, rows: 18, forwarded: 19, peers: 20, joined: 21, left: 22, error: 23,
} as const;

/** Codes of a relay `error`; a newer minor may send others, which a client reads as a refusal. */
export const RELAY_ERROR_CODE = { malformed: 1, incompatibleVersion: 2, tooLarge: 3, staleSnapshot: 4 } as const;

/** A doc id as 32 lowercase hex characters; a frame is a whole share message, opaque to the relay. */
export type RelayClientMessage =
  | { type: "put"; doc: string; frame: Uint8Array }
  | { type: "since"; doc: string; cursor: number }
  | { type: "snapshot"; doc: string; covers: number; frame: Uint8Array }
  /** `to` 0 sends to every other peer. */
  | { type: "forward"; to: number; frame: Uint8Array };

export interface RelayRow { cursor: number; frame: Uint8Array }

export type RelayServerMessage =
  | { type: "accepted"; doc: string; cursor: number }
  | { type: "stored"; from: number; doc: string; cursor: number; frame: Uint8Array }
  | { type: "rows"; doc: string; more: boolean; snapshot?: { covers: number; frame: Uint8Array }; items: RelayRow[] }
  | { type: "forwarded"; from: number; frame: Uint8Array }
  | { type: "peers"; ids: number[] }
  | { type: "joined"; id: number }
  | { type: "left"; id: number }
  /** `doc` is absent when the error concerns no doc. */
  | { type: "error"; code: number; doc?: string };

export type RelayMessage = RelayClientMessage | RelayServerMessage;

/** `minor` is the sender's, so a Worker can keep types a client does not know away from it. */
export type RelayDecodeResult<T> =
  | { ok: true; minor: number; message: T }
  | { ok: false; error: "tooShort" | "tooLarge" | "malformed" }
  | { ok: false; error: "incompatibleVersion"; major: number }
  | { ok: false; error: "unknownType"; type: number };
