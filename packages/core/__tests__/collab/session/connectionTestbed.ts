/** Runs share connections of separate devices over in-process relays, each with in-memory state and an in-memory library. */
import { libraryMirrorDisk, startProjectMirror } from "../../../src/collab/mirror/index";
import { connectShare, type MirrorFactory, type ShareConnection, type ShareStart } from "../../../src/collab/session/index";
import { mergeText } from "../../../src/writing/merge/node/index";
import { LIB, memoryCatalog, readText, writeTree, type MemoryCatalog } from "../../support/memoryProjectCatalog";
import { memoryStorage, type MemoryStorage } from "../state/memoryStorage";
import { FakeClock } from "../sync/fakeNetwork";
import { SHARE_ID, SHARE_KEY } from "../sync/testSession";
import { ONE, RelayHosts } from "../relays/relayGroup";
import { runFor } from "../transport/relay/fakeRelay";

export const FOLDER = `${LIB}/projects/thesis`;

/** One device: its share state, its library and what its connections logged. */
export interface Device {
  storage: MemoryStorage;
  catalog: MemoryCatalog;
  /** Paths the device's mirrors wrote, in order. */
  writes: string[];
  read(file: string): string | undefined;
}

export function newDevice(): Device {
  const catalog = memoryCatalog();
  const writes: string[] = [];
  return {
    storage: memoryStorage(), catalog, writes,
    read: (file) => (catalog.fs.files.has(file) ? readText(catalog.fs, file) : undefined),
  };
}

/** A project folder holding labshelf.yaml, main.typ and, when given, comments.json. */
export async function writeProject(device: Device, comments?: unknown): Promise<void> {
  await writeTree(device.catalog.fs, FOLDER, {
    "labshelf.yaml": "id: thesis\ntitle: Thesis\nformat: typst\nmain: main.typ\n",
    "main.typ": "= Hello\n",
    ...(comments ? { ".labshelf/comments.json": JSON.stringify(comments) } : {}),
  });
}

export const mirrorFactory = (device: Device): MirrorFactory => async ({ folder, session, blobs, store, onStopped }) => {
  const disk = libraryMirrorDisk(device.catalog.fs, folder);
  const mirror = startProjectMirror({
    folder, mergeText, session, blobs, store, logger: device.catalog.logger, stableMs: 10,
    disk: { ...disk, write: async (path, bytes) => { device.writes.push(path); await disk.write(path, bytes); } },
    onStopped: (reason) => onStopped(reason.name),
  });
  return { kind: "running", mirror };
};

export interface ConnectOptions {
  relays?: readonly string[];
  startMirror?: MirrorFactory;
}

export class Network {
  readonly clock = new FakeClock();
  readonly hosts = new RelayHosts(this.clock);

  connect(device: Device, start: ShareStart, options: ConnectOptions = {}): Promise<ShareConnection> {
    return connectShare({
      shareId: SHARE_ID, shareKey: SHARE_KEY, relays: (options.relays ?? [ONE]).map((url) => ({ url })),
      storage: device.storage, projects: { context: device.catalog, libraryRoot: LIB },
      startMirror: options.startMirror ?? mirrorFactory(device), name: "Member", logger: device.catalog.logger,
      network: { scheduler: this.clock, fetch: this.hosts.fetchFor(new Set()), socketFactory: this.hosts.socketFactoryFor(new Set()) },
    }, start);
  }

  /** Advances virtual time until `work` settles, since closing waits for relay answers. */
  async drive<T>(work: Promise<T>): Promise<T> {
    let done = false;
    const watched = work.finally(() => { done = true; });
    watched.catch(() => undefined);
    for (let elapsed = 0; !done && elapsed < 60_000; elapsed += 100) { await runFor(this.clock, 100); }
    return watched;
  }

  /** Requests made to every relay so far; a closed connection adds none. */
  requests(): number {
    return [...this.hosts.requests.values()].reduce((sum, count) => sum + count, 0);
  }
}
