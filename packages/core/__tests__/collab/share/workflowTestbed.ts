/** Runs the share workflows of separate devices over in-process relays, each with in-memory keys, shares, state and library. */
import type { RelayAccount } from "../../../src/relay/account/index";
import { encodeRelayBody } from "../../../src/relay/index";
import { connectShare, type MirrorFactory, type ShareConnection } from "../../../src/collab/session/index";
import type { ShareFlowPorts, StoredInvite } from "../../../src/collab/share/index";
import { parseProjectFile, type ProjectEntry } from "../../../src/writing/project/index";
import { LIB, readText } from "../../support/memoryProjectCatalog";
import { mirrorFactory, Network, newDevice, type Device } from "../session/connectionTestbed";
import { memoryStorage, type MemoryStorage } from "../deviceState/memoryStorage";
import { ONE } from "../relays/relayGroup";

export interface WorkflowDevice extends Device {
  keys: Map<string, StoredInvite>;
  open: Map<string, ShareConnection>;
  states: Map<string, MemoryStorage>;
  ports: ShareFlowPorts;
  /** Folders that hold a labshelf.yaml, sorted. */
  projectFolders(): string[];
}

const ACCOUNT = { relayUrl: ONE, ownerSecret: "owner-secret" } as RelayAccount;

/** Lists every folder holding a labshelf.yaml, as a project list would after a reload. */
function readEntries(device: Device): ProjectEntry[] {
  return device.catalog.fs.fileList().filter((file) => file.endsWith("/labshelf.yaml")).sort().flatMap((file) => {
    const parsed = parseProjectFile(readText(device.catalog.fs, file));
    const folder = file.slice(0, -"/labshelf.yaml".length);
    return parsed.ok ? [{ kind: "ready" as const, folder, location: "library" as const, settings: parsed.settings, main: undefined }] : [];
  });
}

/** `startMirror` replaces the device's disk mirror, so a test can fail the connection after the project is placed. */
export function workflowDevice(net: Network, name: string, startMirror?: MirrorFactory): WorkflowDevice {
  const device = newDevice();
  const keys = new Map<string, StoredInvite>();
  const open = new Map<string, ShareConnection>();
  const busy = new Set<string>();
  const states = new Map<string, MemoryStorage>();
  let entries: ProjectEntry[] = [];
  const ports: ShareFlowPorts = {
    keys: {
      remember: async (invite) => { keys.set(invite.shareId, { ...invite, relays: [...invite.relays] }); },
      invite: async (shareId) => keys.get(shareId),
      forget: async (shareId) => { keys.delete(shareId); },
    },
    shares: {
      active: (shareId) => open.get(shareId),
      list: () => [...open.values()],
      isBusy: (shareId) => busy.has(shareId),
      hold: async (shareId, run) => { busy.add(shareId); try { return await run(); } finally { busy.delete(shareId); } },
      add: (connection) => { open.set(connection.shareId, connection); },
      remove: async (shareId) => {
        const connection = open.get(shareId);
        open.delete(shareId);
        if (connection) { await net.drive(connection.close()); }
      },
    },
    projects: { list: () => entries, reload: async () => { entries = readEntries(device); } },
    files: device.catalog,
    relay: { get: async () => ACCOUNT },
    requireRelay: async () => true,
    connect: (invite, start) => {
      const storage = states.get(invite.shareId) ?? memoryStorage();
      states.set(invite.shareId, storage);
      return connectShare({
        shareId: invite.shareId, shareKey: invite.shareKey, relays: invite.relays, storage, name,
        projects: { context: device.catalog, libraryRoot: LIB }, startMirror: startMirror ?? mirrorFactory(device), logger: device.catalog.logger,
        network: { scheduler: net.clock, fetch: net.hosts.fetchFor(new Set()), socketFactory: net.hosts.socketFactoryFor(new Set()) },
      }, start);
    },
    deleteState: async (shareId) => { states.delete(shareId); },
    userName: () => name,
    logger: device.catalog.logger,
    // The in-process relays take any share, so the owner's claim only has to succeed.
    fetch: async () => new Response(encodeRelayBody({}), { status: 200 }),
  };
  return {
    ...device, keys, open, states, ports,
    projectFolders: () => readEntries(device).map((entry) => entry.folder),
  };
}

/** Closes every connection a device holds, driving the clock so the relay answers arrive. */
export async function closeAll(net: Network, ...devices: WorkflowDevice[]): Promise<void> {
  for (const device of devices) {
    for (const connection of device.open.values()) { await net.drive(connection.close()); }
    device.open.clear();
  }
}
