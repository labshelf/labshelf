/** Opens a project mirror on a temp folder over a share session with no peers, for the tests of the disk mirror. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createProjectIndex } from "../../../../src/collab/model/index";
import { openCollabStore, startProjectMirror, type CollabStore, type ProjectMirror } from "../../../../src/collab/node/index";
import { attachBlobs, createShareSession, type BlobExchange, type ShareSession } from "../../../../src/collab/sync/index";
import { FakeClock, FakeNetwork } from "../../sync/fakeNetwork";
import { contentKey, fakeLogger, SHARE_ID, type FakeLogger } from "../../sync/testSession";

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
  net?: FakeNetwork;
  clock?: FakeClock;
  peer?: string;
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
  const store = await openCollabStore({ dir: stateDir, shareId: SHARE_ID, logger });
  const net = options.net ?? new FakeNetwork(clock);
  const session = createShareSession({
    shareId: SHARE_ID, contentKey: await contentKey(), transport: net.join(options.peer ?? "a"), logger, scheduler: clock,
    index: store.index, createDoc: store.createDoc,
  });
  if (options.project !== false) { createProjectIndex(session.index); }
  const blobs = attachBlobs(session, { contentKey: await contentKey(), getBlob: (hash) => store.blobs.get(hash), logger, scheduler: clock });
  const mirror = startProjectMirror({
    folder, session, blobs, store, logger, watch: false, stableMs: STABLE_MS,
    ...(options.isEditorOwned ? { isEditorOwned: options.isEditorOwned } : {}),
  });
  return {
    folder, stateDir, store, session, blobs, mirror, logger,
    close: async () => {
      blobs.close();
      await mirror.close();
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
