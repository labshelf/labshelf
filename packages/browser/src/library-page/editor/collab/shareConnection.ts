// Connects to a share through the first relay of its invite: the session, its presence and the relay sync.
import {
  attachAwareness, attachRelaySync, createRelayTransport, createShareSession, deriveAwarenessKey, deriveContentKey, deriveRelayToken,
  type ILogger, type Invite, type PresenceHandle, type RelayTransport, type RelayTransportOptions, type ShareSession,
} from "@labshelf/core";

const LOG_MODULE = "collab.connection";

export interface ConnectShareOptions {
  invite: Invite;
  logger: ILogger;
  /** Tests pass a fake relay; the page uses the WebSocket relay. */
  createTransport?: ((options: RelayTransportOptions) => RelayTransport) | undefined;
}

export interface ShareConnection {
  session: ShareSession;
  presence: PresenceHandle;
  close(): Promise<void>;
}

export async function connectShare({ invite, logger, createTransport = createRelayTransport }: ConnectShareOptions): Promise<ShareConnection> {
  const relayUrl = invite.relays[0]?.url;
  if (relayUrl === undefined) { throw new Error(`Share ${invite.shareId} lists no relay`); }
  const [relayToken, contentKey, awarenessKey] = await Promise.all([
    deriveRelayToken(invite.shareKey), deriveContentKey(invite.shareKey), deriveAwarenessKey(invite.shareKey),
  ]);
  const { shareId } = invite;
  const transport = createTransport({ relayUrl, shareId, relayToken, logger });
  const session = createShareSession({ shareId, contentKey, transport, logger });
  const presence = attachAwareness(session, { awarenessKey, logger });
  const stopConnection = transport.onConnection((open) => {
    void logger.log("INFO", LOG_MODULE, open ? "Relay connected" : "Relay disconnected", { shareId, relay: relayUrl });
    if (open) { presence.setRelay({ relay: relayUrl, relaysDown: {} }); }
  });
  const relaySync = attachRelaySync(session, { relay: transport, shareId, contentKey, logger, isSnapshotWriter: () => presence.isLowestId() });
  return {
    session,
    presence,
    close: async () => {
      stopConnection();
      // The relay sync puts its last updates over the socket that closing the session closes.
      await relaySync.close();
      await presence.close();
      await session.close();
      await logger.log("INFO", LOG_MODULE, "Closed the share connection", { shareId });
    },
  };
}
