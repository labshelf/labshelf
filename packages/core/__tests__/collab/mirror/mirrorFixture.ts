/** Opens a project mirror on a project folder over a share session, alone or on a fake relay, for the tests of the disk mirror. */
import { createShareIndexDoc, attachShareBlobs, type ShareBlobExchange, createShareSession, type ShareSession } from "../../../src/collab/doc/index";
import { startProjectMirror, type MirrorFileSystem, type MirrorStopReason, type ProjectMirror, type ProjectMirrorOptions } from "../../../src/collab/mirror/index";
import { createNodeCollabStorage } from "../../../src/collab/node/index";
import { mergeText } from "../../../src/writing/conflict/node/index";
import { openCollabStore, type CollabStore } from "../../../src/collab/deviceState/index";
import { deriveRelayToken } from "../../../src/collab/invite/index";
import { attachRelaySync } from "../../../src/collab/relays/relaySync";
import { createRelayTransport, type PeerTransport } from "../../../src/collab/transport/index";
import { FakeClock, FakeNetwork } from "../peer/fakeNetwork";
import { contentKey, fakeLogger, SHARE_ID, SHARE_KEY, type FakeLogger } from "../doc/testSession";
import type { FakeRelay } from "../transport/relay/fakeRelay";
import { RELAY_URL } from "../transport/relay/relayClient";
import { nodeFiles, tempDir, type MirrorFiles } from "./mirrorFiles";

export const STABLE_MS = 40;

export interface MirrorFixture {
  files: MirrorFiles;
  folder: string;
  stateDir: string;
  /** The paths the mirror wrote or deleted on disk, in order. */
  diskChanges: string[];
  store: CollabStore;
  session: ShareSession;
  blobs: ShareBlobExchange;
  mirror: ProjectMirror;
  logger: FakeLogger;
  writeRecords: ReturnType<MirrorFiles["records"]>;
  close(): Promise<void>;
}

export interface FixtureOptions {
  /** The relay the mirror's members meet on; without one the session has no peers. */
  relay?: FakeRelay;
  onConflictCopy?: ProjectMirrorOptions["onConflictCopy"];
  readConflictDismissals?: ProjectMirrorOptions["readConflictDismissals"];
  clock?: FakeClock;
  /** Marks the index as a project's before the mirror starts. */
  project?: boolean;
  folder?: string;
  stateDir?: string;
  isEditorOwned?: (path: string) => boolean;
  files?: MirrorFiles;
  ownership?: { assertOwned(): Promise<void> };
  onStopped?: (reason: MirrorStopReason) => void;
}

/** The disk without its watcher, since tests call `changed`, recording every write and delete that reaches it. */
function recordingDisk(disk: MirrorFileSystem, changes: string[]): MirrorFileSystem {
  return {
    read: (file, stableMs) => disk.read(file, stableMs),
    list: () => disk.list(),
    write: (file, bytes) => { changes.push(file); return disk.write(file, bytes); },
    remove: (file) => { changes.push(file); return disk.remove(file); },
  };
}

export async function openMirror(options: FixtureOptions = {}): Promise<MirrorFixture> {
  const clock = options.clock ?? new FakeClock();
  const files = options.files ?? nodeFiles;
  const folder = options.folder ?? await files.newFolder("mirror-folder");
  const stateDir = options.stateDir ?? await tempDir("mirror-state");
  const logger = fakeLogger();
  const store = await openCollabStore({ storage: createNodeCollabStorage({ dir: stateDir, shareId: SHARE_ID }), logger });
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
  if (options.project !== false) { createShareIndexDoc(session.index); }
  const blobs = attachShareBlobs(session, { contentKey: await contentKey(), getBlob: (hash) => store.blobs.get(hash), logger, scheduler: clock, skipPeer: () => false });
  const diskChanges: string[] = [];
  const writeRecords = files.records(folder, logger);
  const mirror = startProjectMirror({
    writeRecords, folder, disk: recordingDisk(files.disk(folder, logger), diskChanges), mergeText, session, blobs, store, logger, stableMs: STABLE_MS,
    ...(options.isEditorOwned ? { isEditorOwned: options.isEditorOwned } : {}),
    ...(options.ownership ? { ownership: options.ownership } : {}),
    ...(options.onConflictCopy ? { onConflictCopy: options.onConflictCopy } : {}),
    ...(options.readConflictDismissals ? { readConflictDismissals: options.readConflictDismissals } : {}),
    ...(options.onStopped ? { onStopped: options.onStopped } : {}),
  });
  return {
    writeRecords, files, folder, stateDir, diskChanges, store, session, blobs, mirror, logger,
    close: async () => {
      blobs.close();
      await mirror.close();
      await relaySync?.close();
      await session.close();
      await store.close();
    },
  };
}

export async function readFile(fixture: MirrorFixture, file: string): Promise<string> {
  const data = await fixture.files.read(fixture.folder, file);
  if (!data) { throw new Error(`${file} is not on disk`); }
  return new TextDecoder().decode(data);
}

export const writeFile = (fixture: MirrorFixture, file: string, content: string | Uint8Array) => fixture.files.write(fixture.folder, file, content);

export const exists = async (fixture: MirrorFixture, file: string) => (await fixture.files.read(fixture.folder, file)) !== undefined;

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
