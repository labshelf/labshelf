// Borrows TURN servers for a share's mesh from the first of its relays that lends them.
import { fetchTicket, fetchTurnServers, type ILogger } from "@labshelf/core";

type TurnServers = Awaited<ReturnType<typeof fetchTurnServers>>;

/** Short, because the mesh waits for TURN before it is created. */
const TURN_TIMEOUT_MS = 3000;

const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(TURN_TIMEOUT_MS) });

/** Undefined when no relay lends any; the mesh then goes without TURN. */
export async function meshTurn(relayUrls: readonly string[], shareId: string, relayToken: string, logger: ILogger): Promise<TurnServers | undefined> {
  for (const relayUrl of relayUrls) {
    try {
      const { ticket } = await fetchTicket({ relayUrl, shareId, relayToken, fetch: timedFetch });
      const servers = await fetchTurnServers({ relayUrl, shareId, ticket, fetch: timedFetch });
      void logger.log("INFO", "collab", "Borrowed TURN servers from a relay", { relayUrl, shareId });
      return servers;
    } catch (error) {
      void logger.log("WARN", "collab", "A relay lent no TURN servers", { relayUrl, shareId, error: String(error) });
    }
  }
  if (relayUrls.length > 0) { void logger.log("WARN", "collab", "Connecting without TURN: no relay of the share lent TURN servers", { shareId }); }
  return undefined;
}
