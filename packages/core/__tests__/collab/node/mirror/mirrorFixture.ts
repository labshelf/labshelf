/** Opens a project mirror on a temp folder over a share session, alone or on a fake relay, for the tests of the disk mirror. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createProjectIndex } from "../../../../src/collab/model/index";
import { nodeCollabStorage, startProjectMirror, type ProjectMirror } from "../../../../src/collab/node/index";
import { openCollabStore, type CollabStore } from "../../../../src/collab/state/index";
import { deriveRelayToken } from "../../../../src/collab/crypto/index";
import { attachBlobs, attachRelaySync, createShareSession, type BlobExchange, type ShareSession } from "../../../../src/collab/sync/index";
import { createRelayTransport, type PeerTransport } from "../../../../src/collab/transport/index";
import { FakeClock, FakeNetwork } from "../../sync/fakeNetwork";
import { contentKey, fakeLogger, SHARE_ID, SHARE_KEY, type FakeLogger } from "../../sync/testSession";
import type { FakeRelay } from "../../transport/relay/fakeRelay";
import { RELAY_URL } from "../../transport/relay/relayClient";

export const STABLE_MS = 40;

export interface MirrorFixture {
  folder: string;
  stateDir: string;
  store: CollabStore;
  session: ShareSession;
  blobs: BlobExchange;
  mirror: ProjectMirror;
  logger: FakeLogger;
  close(): Promise<void>;
}

export interface FixtureOptions {
  /** The relay the mirror's members meet on; without one the session has no peers. */
  relay?: FakeRelay;
  clock?: FakeClock;
  /** Marks the index as a project's before the mirror starts. */
  project?: boolean;
  folder?: string;
  stateDir?: string;
  isEditorOwned?: (path: string) => boolean;
}

export const tempDir = (label: string) => fs.mkdtemp(path.join(os.tmpdir(), `labshelf-${label}-`));

export async function openMirror(options: FixtureOptions = {}): Promise<MirrorFixture> {
  const clock = options.clock ?? new FakeClock();
  const folder = options.folder ?? await tempDir("mirror-folder");
  const stateDir = options.stateDir ?? await tempDir("mirror-state");
  const logger = fakeLogger();
  const store = await openCollabStore({ storage: nodeCollabStorage({ dir: stateDir, shareId: SHARE_ID }), logger });
  const relay = options.relay ? createRelayTransport({
    relayUrl: RELAY_URL, shareId: SHARE_ID, relayToken: await deriveRelayToken(SHARE_KEY), logger,
    socketFactory: options.relay.socketFactory, fetch: options.relay.fetch, scheduler: clock,
  }) : undefined;
  const transport: PeerTransport = relay ?? new FakeNetwork(clock).join("a");
  const session = createShareSession({
    shareId: SHARE_ID, contentKey: await contentKey(), transport, logger, scheduler: clock,
    index: store.index, createDoc: store.createDoc,
  });
  const relaySync = relay ? attachRelaySync(session, { relay, shareId: SHARE_ID, contentKey: await contentKey(), logger, scheduler: clock, isSnapshotWriter: () => true }) : undefined;
  if (options.project !== false) { createProjectIndex(session.index); }
  const blobs = attachBlobs(session, { contentKey: await contentKey(), getBlob: (hash) => store.blobs.get(hash), logger, scheduler: clock, skipPeer: () => false });
  const mirror = startProjectMirror({
    folder, session, blobs, store, logger, watch: false, stableMs: STABLE_MS,
    ...(options.isEditorOwned ? { isEditorOwned: options.isEditorOwned } : {}),
  });
  return {
    folder, stateDir, store, session, blobs, mirror, logger,
    close: async () => {
      blobs.close();
      await mirror.close();
      await relaySync?.close();
      await session.close();
      await store.close();
    },
  };
}

export const readFile = (fixture: MirrorFixture, file: string) => fs.readFile(path.join(fixture.folder, file), "utf8");

export async function writeFile(fixture: MirrorFixture, file: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(path.join(fixture.folder, file)), { recursive: true });
  await fs.writeFile(path.join(fixture.folder, file), content);
}

export const exists = (fixture: MirrorFixture, file: string) =>
  fs.stat(path.join(fixture.folder, file)).then(() => true, () => false);

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
