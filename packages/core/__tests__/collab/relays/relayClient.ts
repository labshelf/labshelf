/** Opens share sessions that reach each other only through a fake relay, with the relay sync and presence attached. */
import * as Y from "yjs";
import { derivePresenceShareKey, deriveContentShareKey, deriveRelayToken } from "../../../src/collab/invite/index";
import { attachPresence, type PresenceStore } from "../../../src/collab/index";
import { createShareSession, type ShareSession } from "../../../src/collab/index";
import { attachRelaySync, createRelayTransport, type RelayCursorStore, type RelaySync, type RelayTransport } from "../../../src/collab/relays/index";
import type { FakeClock } from "../fakeNetwork";
import { fakeLogger, SHARE_ID, SHARE_KEY, type FakeLogger } from "../testSession";
import type { FakeRelay } from "./fakeRelay";

export const RELAY_URL = "https://relay.example.workers.dev";
export const DOC_PATH = "main.tex";

export interface RelayClient {
  session: ShareSession;
  relay: RelayTransport;
  relaySync: RelaySync;
  presence: PresenceStore;
  logger: FakeLogger;
  text(): Y.Text;
  close(): Promise<void>;
}

export async function openRelayClient(fake: FakeRelay, clock: FakeClock, docs: Y.Doc[] = [], cursors?: RelayCursorStore): Promise<RelayClient> {
  const logger = fakeLogger();
  const contentKey = await deriveContentShareKey(SHARE_KEY);
  const relay = createRelayTransport({
    relayUrl: RELAY_URL, shareId: SHARE_ID, relayToken: await deriveRelayToken(SHARE_KEY), logger,
    socketFactory: fake.socketFactory, fetch: fake.fetch, scheduler: clock,
  });
  const byPath = new Map<string, Y.Doc>();
  if (docs[0]) { byPath.set(DOC_PATH, docs[0]); }
  const session = createShareSession({
    shareId: SHARE_ID, contentKey, transport: relay, logger, scheduler: clock,
    createDoc: (path) => byPath.get(path) ?? new Y.Doc(),
  });
  const presence = attachPresence(session, { awarenessKey: await derivePresenceShareKey(SHARE_KEY), logger });
  const relaySync = attachRelaySync(session, { relay, shareId: SHARE_ID, contentKey, logger, scheduler: clock, isSnapshotWriter: () => presence.isLowestId(), ...(cursors ? { cursors } : {}) });
  session.openDoc(DOC_PATH);
  return {
    session, relay, relaySync, presence, logger,
    text: () => session.openDoc(DOC_PATH).getText("body"),
    close: async () => {
      await relaySync.close();
      await presence.close();
      await session.close();
    },
  };
}
