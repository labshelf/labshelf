// Picks the relay a share connects through and opens it: its transport and the TURN servers it lends the mesh.
import {
  createRelayTransport, deriveRelayToken, fetchTicket, fetchTurnServers, type ILogger, type InviteRelay, type RelayTransport,
} from "@labshelf/core";

type TurnServers = Awaited<ReturnType<typeof fetchTurnServers>>;

export interface ShareRelay {
  url: string;
  transport: RelayTransport;
  /** Undefined when the relay lent none; the mesh then goes without TURN. */
  turnConfig: TurnServers | undefined;
}

/** The one relay a share uses out of its invite's list. */
export const chooseRelay = (relays: readonly InviteRelay[]): InviteRelay | undefined => relays[0];

async function turnServers(relayUrl: string, shareId: string, relayToken: string, logger: ILogger): Promise<TurnServers | undefined> {
  try {
    const { ticket } = await fetchTicket({ relayUrl, shareId, relayToken });
    return await fetchTurnServers({ relayUrl, shareId, ticket });
  } catch (error) {
    void logger.log("WARN", "collab", "Connecting without TURN: the relay lent no TURN servers", { relayUrl, shareId, error: String(error) });
    return undefined;
  }
}

/** Fetches TURN first, because the mesh takes it when it is created. */
export async function openShareRelay(relay: InviteRelay, shareId: string, shareKey: Uint8Array, logger: ILogger): Promise<ShareRelay> {
  // CONTRACT: documents/contracts/collaboration.md#share-key
  const relayToken = relay.relayToken ?? (await deriveRelayToken(shareKey));
  const turnConfig = await turnServers(relay.url, shareId, relayToken, logger);
  const transport = createRelayTransport({ relayUrl: relay.url, shareId, relayToken, logger });
  void logger.log("INFO", "collab", "Connecting the share through its relay", { relayUrl: relay.url, shareId, turn: turnConfig !== undefined });
  return { url: relay.url, transport, turnConfig };
}
