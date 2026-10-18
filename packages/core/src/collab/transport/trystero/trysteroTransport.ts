// Connects peers of one share through trystero's Nostr signalling and WebRTC data channels.
import type { Room } from "@trystero-p2p/nostr";
import { deriveRoomCredentials, type RoomCredentials } from "../../crypto/index.js";
import type { PeerId, PeerTransport } from "../peerTransport.js";
import { DEFAULT_RELAY_URLS, TRYSTERO_APP_ID } from "./trysteroOptions.js";
import type { TrysteroTransportOptions } from "./trysteroOptions.js";

const MODULE = "trystero-transport";
const FRAME_ACTION = "f";
const REJOIN_MIN_MS = 1_000;
const REJOIN_MAX_MS = 30_000;

type Listeners<A extends unknown[]> = Set<(...args: A) => void>;
type Log = (level: "INFO" | "WARN", message: string, context?: Record<string, unknown>) => void;
type SendFrame = (bytes: Uint8Array, target: PeerId | null) => Promise<void>;

interface PeerEvents {
  peers: Set<PeerId>;
  message: Listeners<[PeerId, Uint8Array]>;
  join: Listeners<[PeerId]>;
  leave: Listeners<[PeerId]>;
}

function subscribe<A extends unknown[]>(set: Listeners<A>, listener: (...args: A) => void): () => void {
  set.add(listener);
  return () => set.delete(listener);
}

/** Routes a joined room's frames and peer changes to the transport's listeners and returns the frame sender. */
function wireRoom(joined: Room, events: PeerEvents, log: Log): SendFrame {
  const frames = joined.makeAction<Uint8Array>(FRAME_ACTION);
  frames.onMessage = (bytes, { peerId }) => {
    // INVARIANT: trystero delivers binary payloads as Uint8Array, which sync treats as an opaque frame.
    for (const listener of events.message) listener(peerId, bytes);
  };
  joined.onPeerJoin = (peer) => {
    events.peers.add(peer);
    log("INFO", "peer joined", { peer, peers: events.peers.size });
    for (const listener of events.join) listener(peer);
  };
  joined.onPeerLeave = (peer) => {
    events.peers.delete(peer);
    log("INFO", "peer left", { peer, peers: events.peers.size });
    for (const listener of events.leave) listener(peer);
  };
  return (bytes, target) => frames.send(bytes, { target });
}

type JoinRoom = typeof import("@trystero-p2p/nostr").joinRoom;

function openRoom(joinRoom: JoinRoom, options: TrysteroTransportOptions, credentials: RoomCredentials, log: Log): Room {
  return joinRoom(
    {
      appId: TRYSTERO_APP_ID,
      password: credentials.password,
      relayConfig: { urls: [...(options.relayUrls ?? DEFAULT_RELAY_URLS)] },
      ...(options.turnConfig ? { turnConfig: options.turnConfig } : {}),
      ...(options.rtcPolyfill ? { rtcPolyfill: options.rtcPolyfill } : {}),
    },
    credentials.roomId,
    { onJoinError: (details) => log("WARN", "join error", { ...details }) },
  );
}

function sendLogged(sendFrame: SendFrame, to: PeerId | "all", bytes: Uint8Array, log: Log): void {
  sendFrame(bytes, to === "all" ? null : to).catch((error: unknown) => {
    log("WARN", "send failed", { to, error: String(error) });
  });
}

const subscriptions = (events: PeerEvents) => ({
  onMessage: (listener: (from: PeerId, bytes: Uint8Array) => void) => subscribe(events.message, listener),
  onPeerJoin: (listener: (peer: PeerId) => void) => subscribe(events.join, listener),
  onPeerLeave: (listener: (peer: PeerId) => void) => subscribe(events.leave, listener),
});

export async function createTrysteroTransport(options: TrysteroTransportOptions): Promise<PeerTransport> {
  const credentials = "room" in options ? options.room : await deriveRoomCredentials(options.shareKey);
  const log: Log = (level, message, context) => {
    void options.logger.log(level, MODULE, message, { roomId: credentials.roomId, ...context });
  };

  // PLATFORM: trystero ships only ESM, so it loads on first use and core's CommonJS consumers (Jest) never require it.
  const { joinRoom } = await import("@trystero-p2p/nostr");
  const events: PeerEvents = { peers: new Set(), message: new Set(), join: new Set(), leave: new Set() };
  let room: Room | undefined;
  let sendFrame: SendFrame | undefined;
  let rejoinTimer: ReturnType<typeof setTimeout> | undefined;
  let rejoinDelay = REJOIN_MIN_MS;
  let closed = false;

  const join = (): void => {
    try {
      const joined = openRoom(joinRoom, options, credentials, log);
      sendFrame = wireRoom(joined, events, log);
      room = joined;
      rejoinDelay = REJOIN_MIN_MS;
    } catch (error) {
      // TRAP: trystero throws synchronously on a bad config, but also while its sockets are unusable, so retry.
      log("WARN", "join failed, retrying", { error: String(error), delayMs: rejoinDelay });
      rejoinTimer = setTimeout(join, rejoinDelay);
      rejoinDelay = Math.min(rejoinDelay * 2, REJOIN_MAX_MS);
    }
  };
  join();

  return {
    get peers() {
      return [...events.peers];
    },
    send(to, bytes) {
      if (sendFrame) sendLogged(sendFrame, to, bytes, log);
    },
    ...subscriptions(events),
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(rejoinTimer);
      sendFrame = undefined;
      events.peers.clear();
      await room?.leave();
      log("INFO", "closed");
    },
  };
}
