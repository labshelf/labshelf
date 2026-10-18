// Declares the options and relay defaults of the trystero peer transport.
import type { BaseRoomConfig, TurnServerConfig } from "@trystero-p2p/nostr";
import type { ILogger } from "../../../ports/logger.js";
import type { RoomCredentials } from "../../crypto/index.js";

/** Namespaces the Nostr topics every LabShelf room is announced under. */
export const TRYSTERO_APP_ID = "labshelf";

// Three relays that were open in 30 of 30 probe joins, plus one large public relay as a fallback.
// TRAP: relay.damus.io bans an address after a burst of joins, so it is left out.
export const DEFAULT_RELAY_URLS: readonly string[] = [
  "wss://relay.routstr.com",
  "wss://relay-dev.gulugulu.moe",
  "wss://relay.novospes.com",
  "wss://nos.lol",
];

export type TrysteroRoom = { shareKey: Uint8Array } | { room: RoomCredentials };

export type TrysteroTransportOptions = TrysteroRoom & {
  logger: ILogger;
  relayUrls?: readonly string[];
  /** TURN servers used when a direct path fails. */
  turnConfig?: TurnServerConfig[];
  /** A WebRTC implementation for hosts without a native one (the extension host passes node-datachannel). */
  rtcPolyfill?: BaseRoomConfig["rtcPolyfill"];
};
