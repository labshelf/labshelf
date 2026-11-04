/**
 * The workflows of a shared Space: how a Space becomes a share, how a member's join creates it in the library, leaving it, and
 * the operations an app's Space page runs over them.
 */
// CONTRACT: documents/contracts/spaces.md#sharing
import type { Doc } from "yjs";
import { baseName } from "../path/index.js";
import { createShareIndexDoc, readSharedJsonDoc, SPACE_JSON_SPEC } from "../collab/index.js";
import { parseSpaceFile, serializeSpaceFile, SpaceStore, type SpaceShareView } from "../spaces/index.js";
import type { ProjectReadContext } from "../writing/project/index.js";
import { createLibraryLayout, SPACE_FILE } from "../library/index.js";
import { startPlaceShare, type SharePlace, type ShareOutcome, type ShareRequest } from "./projectShareFlows.js";
import { LOG_MODULE, type ShareFlowPorts } from "./sharedProjects.js";
import { deriveSharedState } from "./projectShare.js";
import { downloadSpacePapers, type DownloadSpacePapersOutcome, type DownloadSpacePapersRequest, type SpaceShareDeps } from "./spaceShareSync.js";
import type { ShareConnection } from "../collab/session/index.js";
import type { MutationContext } from "../library/index.js";

/** space.json with `shared` set or removed; the file must be one this app writes. */
async function writeSharedField({ fs, paths }: ProjectReadContext, folder: string, shared: string | undefined, onlyIf?: string): Promise<void> {
  const file = paths.join(folder, SPACE_FILE);
  const read = parseSpaceFile(await fs.readText(file), { id: baseName(folder), path: file });
  if (read.state === "unreadable") { throw new Error(`${file} cannot be read: ${read.reason}`); }
  if (read.readOnlyReason !== undefined) { throw new Error(read.readOnlyReason); }
  if (onlyIf !== undefined && read.space.shared !== onlyIf) { return; }
  const { shared: _previous, ...rest } = read.space;
  await fs.writeText(file, serializeSpaceFile(shared === undefined ? rest : { ...rest, shared }));
}

export interface StartSpaceShareRequest {
  folder: string;
  shareId: string;
  index: Doc;
}

/** Marks the index as a Space's and writes `shared: <shareId>` into space.json, keeping every other key. */
export async function startSpaceShareFile(context: ProjectReadContext, request: StartSpaceShareRequest): Promise<void> {
  createShareIndexDoc(request.index, "space");
  await writeSharedField(context, request.folder, request.shareId);
  await context.logger.log("INFO", LOG_MODULE, "Shared a Space", { folder: request.folder, shareId: request.shareId });
}

export interface JoinSpaceShareRequest {
  libraryRoot: string;
  shareId: string;
  /** The share's index doc, synced far enough to hold the Space's name. */
  index: Doc;
}

/** Creates `spaces/<id>/` named from the share, with an id free in this library, and marks it as the share's copy. */
export async function joinSpaceShareFile(context: ProjectReadContext, request: JoinSpaceShareRequest): Promise<{ id: string; folder: string }> {
  const { fs, paths, logger } = context;
  const name = readSharedJsonDoc(request.index, SPACE_JSON_SPEC).values["name"];
  const store = new SpaceStore({ root: request.libraryRoot, fs, paths, logger });
  const id = await store.createSpace(typeof name === "string" && name.trim() !== "" ? name : "Shared Space");
  await store.setShared(id, request.shareId);
  const folder = createLibraryLayout(request.libraryRoot, (base, ...segments) => paths.join(base, ...segments)).spaceDir(id);
  await logger.log("INFO", LOG_MODULE, "Created the Space of a joined share", { folder, shareId: request.shareId });
  return { id, folder };
}

export function spacePlace(ports: ShareFlowPorts, folder: string): SharePlace {
  return {
    kind: "space",
    file: ports.files.paths.join(folder, SPACE_FILE),
    sharedIn: (text) => { const read = parseSpaceFile(text, { id: baseName(folder), path: "" }); return read.state === "ready" ? read.space.shared : undefined; },
    reload: async () => { await ports.spaces?.reload(); },
  };
}

/** Shares the Space in `folder`, or reconnects it when `shared` names its share already. */
export function startSpaceShare(ports: ShareFlowPorts, request: ShareRequest): Promise<ShareOutcome> {
  return startPlaceShare(ports, spacePlace(ports, request.folder), request);
}

/**
 * The other members keep the share and nothing on the relay is deleted. When the connection cannot store its pending updates
 * the leave stops before anything is forgotten, so a retry loses nothing. The Space's projects stay shared.
 */
export async function leaveSharedSpace(ports: ShareFlowPorts, space: { folder: string; shareId: string }): Promise<void> {
  const { folder, shareId } = space;
  await ports.shares.hold(shareId, async () => {
    try {
      await ports.shares.remove(shareId);
    } catch (error) {
      throw new Error(`The shared Space in ${folder} could not store its last edits, so it stays shared: ${String(error)}`, { cause: error });
    }
    await ports.keys.forget(shareId);
    await writeSharedField(ports.files, folder, undefined, shareId);
    await ports.deleteState(shareId);
    await ports.spaces?.reload();
  });
  void ports.logger.log("INFO", LOG_MODULE, "Stopped sharing a Space on this device", { folder, shareId });
}

/** What an app's Space page runs: share, hand out the invite, leave, and download the papers this library lacks. */
export interface SpaceShareOps {
  /** The share as the Space page shows it. */
  status(spaceId: string): SpaceShareView;
  /** Shares the Space, or reconnects it when shared, and resolves to the invite to hand out. */
  share(spaceId: string, signal: AbortSignal): Promise<{ kind: "shared"; invite: string } | { kind: "noRelay" | "noKey" }>;
  leave(spaceId: string): Promise<void>;
  download(request: Omit<DownloadSpacePapersRequest, "ctx">): Promise<DownloadSpacePapersOutcome>;
}

const NOT_IN_LIBRARY = "This Space is not in the open library.";

export function createSpaceShareOps(deps: SpaceShareDeps, ctx: () => MutationContext): SpaceShareOps {
  const { ports } = deps;
  const find = (spaceId: string) => {
    const entry = ports.spaces?.list().find((candidate) => candidate.id === spaceId);
    if (!entry) { throw new Error(NOT_IN_LIBRARY); }
    return entry;
  };
  const connectionOf = (spaceId: string): ShareConnection => {
    const { shared } = find(spaceId);
    const connection = shared === undefined ? undefined : ports.shares.active(shared);
    if (!connection) { throw new Error("Connect this shared Space before downloading its papers."); }
    return connection;
  };
  return {
    status: (spaceId) => {
      const entry = ports.spaces?.list().find((candidate) => candidate.id === spaceId);
      if (entry?.shared === undefined) { return { shared: false, connected: false }; }
      const { kind: _shared, ...state } = deriveSharedState(ports.shares.active(entry.shared));
      return { shared: true, ...state };
    },
    share: async (spaceId, signal) => {
      const { folder, shared } = find(spaceId);
      if (shared !== undefined && ports.shares.isBusy(shared)) { throw new Error("This shared Space is busy; try again in a moment."); }
      const outcome = await startSpaceShare(ports, { folder, shared, signal });
      return outcome.kind === "shared" ? { kind: "shared", invite: outcome.invite } : { kind: outcome.kind };
    },
    leave: async (spaceId) => {
      const { folder, shared } = find(spaceId);
      if (shared === undefined) { throw new Error("This Space is not shared."); }
      await leaveSharedSpace(ports, { folder, shareId: shared });
    },
    download: (request) => downloadSpacePapers(connectionOf(request.spaceId), deps, { ...request, ctx: ctx() }),
  };
}
