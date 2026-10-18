// Connects peers of one share through trystero's Nostr signalling and WebRTC data channels.
import type { Room } from "@trystero-p2p/nostr";
import { deriveRoomCredentials } from "../../crypto/index.js";
import type { PeerId, PeerTransport } from "../peerTransport.js";
import { DEFAULT_RELAY_URLS, TRYSTERO_APP_ID } from "./trysteroOptions.js";
import type { TrysteroTransportOptions } from "./trysteroOptions.js";

const MODULE = "trystero-transport";
const FRAME_ACTION = "f";
const REJOIN_MIN_MS = 1_000;
const REJOIN_MAX_MS = 30_000;

type Listeners<A extends unknown[]> = Set<(...args: A) => void>;

function subscribe<A extends unknown[]>(set: Listeners<A>, listener: (...args: A) => void): () => void {
  set.add(listener);
  return () => set.delete(listener);
}

export async function createTrysteroTransport(options: TrysteroTransportOptions): Promise<PeerTransport> {
  const { logger } = options;
  const credentials = "room" in options ? options.room : await deriveRoomCredentials(options.shareKey);
  const log = (level: "INFO" | "WARN", message: string, context?: Record<string, unknown>): void => {
    void logger.log(level, MODULE, message, { roomId: credentials.roomId, ...context });
  };

  // PLATFORM: trystero ships only ESM, so it loads on first use and core's CommonJS consumers (Jest) never require it.
  const { joinRoom } = await import("@trystero-p2p/nostr");
  const peers = new Set<PeerId>();
  const messageListeners: Listeners<[PeerId, Uint8Array]> = new Set();
  const joinListeners: Listeners<[PeerId]> = new Set();
  const leaveListeners: Listeners<[PeerId]> = new Set();
  let room: Room | undefined;
  let sendFrame: ((bytes: Uint8Array, target: PeerId | null) => Promise<void>) | undefined;
  let rejoinTimer: ReturnType<typeof setTimeout> | undefined;
  let rejoinDelay = REJOIN_MIN_MS;
  let closed = false;

  const join = (): void => {
    try {
      const joined = joinRoom(
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
      const frames = joined.makeAction<Uint8Array>(FRAME_ACTION);
      frames.onMessage = (bytes, { peerId }) => {
        // INVARIANT: trystero delivers binary payloads as Uint8Array, which sync treats as an opaque frame.
        for (const listener of messageListeners) listener(peerId, bytes);
      };
      joined.onPeerJoin = (peer) => {
        peers.add(peer);
        log("INFO", "peer joined", { peer, peers: peers.size });
        for (const listener of joinListeners) listener(peer);
      };
      joined.onPeerLeave = (peer) => {
        peers.delete(peer);
        log("INFO", "peer left", { peer, peers: peers.size });
        for (const listener of leaveListeners) listener(peer);
      };
      sendFrame = (bytes, target) => frames.send(bytes, { target });
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
      return [...peers];
    },
    send(to, bytes) {
      if (!sendFrame) return;
      sendFrame(bytes, to === "all" ? null : to).catch((error: unknown) => {
        log("WARN", "send failed", { to, error: String(error) });
      });
    },
    onMessage: (listener) => subscribe(messageListeners, listener),
    onPeerJoin: (listener) => subscribe(joinListeners, listener),
    onPeerLeave: (listener) => subscribe(leaveListeners, listener),
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(rejoinTimer);
      sendFrame = undefined;
      peers.clear();
      await room?.leave();
      log("INFO", "closed");
    },
  };
}
