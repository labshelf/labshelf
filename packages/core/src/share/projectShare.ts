/**
 * The sharing host over the core share workflows: project share state and operations, paper-folder link operations, the host
 * that composes them, and the notices for store failures.
 */
import type { ShareConnection, ShareConnectionState } from "../collab/session/index.js";
import type { ProjectEntry } from "../writing/project/index.js";
import type { ProjectShareState, JoinProjectResult, ShareHost, ShareProjectResult, ShareLinkImportResult } from "./libraryShareHost.js";
import { joinSharedProject, leaveSharedProject, startProjectShare } from "./projectShareFlows.js";
import { isSharedProject, readCurrentInvite, type SharedProject, type ShareFlowPorts } from "./sharedProjects.js";
import {
  OPEN_SHARE_FAILURE, describeRefusedShareLink, describeSharedImport, listShareableFolders, createShareLink,
  type FolderShareSources, type ImportShareLinkOptions, type ImportShareLinkResult,
} from "./flow/index.js";
import { deriveShareLinkOfEntry, loadShareRegistry, type ShareRegistryStore } from "./shareRegistry.js";
import { removeShare } from "./removeShare.js";
import type { ShareBackend, ShareReader } from "./shareBackend.js";
import type { ILogger } from "../ports/index.js";
import { isUnderDir } from "../library/index.js";
import type { PaperRecord } from "../model/index.js";
import type { RelayAccount } from "../relay/index.js";

const TRASHED = "This project is in the trash.";
const UNREADABLE = "LabShelf cannot read this project's settings.";

/** Undefined when the project may be shared or left here. */
function deriveIneligibleReason(entry: ProjectEntry): string | undefined {
  if (entry.kind !== "ready") { return UNREADABLE; }
  return entry.settings.trashed ? TRASHED : undefined;
}

function mirrorProblem(mirror: ShareConnectionState["mirror"]): string | undefined {
  if (mirror.kind === "stopped") { return `Edits are not written to disk: ${mirror.reason}`; }
  if (mirror.kind === "running") { return undefined; }
  const who = mirror.holder === "tab" ? "Another tab of this browser" : mirror.holder.app === "vscode" ? "VS Code" : "The browser";
  return `${who} mirrors this project's files; edits here are not written to disk.`;
}

/** The name a project goes by in messages. */
export function deriveProjectName(entry: ProjectEntry): string {
  return entry.kind === "ready" ? entry.settings.title ?? entry.settings.id : entry.folder.split(/[\\/]/).filter(Boolean).pop() ?? entry.folder;
}

/** What keeps a connected share's edits from this device's storage or disk; undefined when nothing does. */
export function deriveConnectionProblem(connection: ShareConnection): string | undefined {
  const state = connection.state();
  return state.persistenceFailure ?? mirrorProblem(state.mirror);
}

function deriveProjectShare(entry: ProjectEntry, connection: ShareConnection | undefined): ProjectShareState {
  const reason = deriveIneligibleReason(entry);
  if (reason !== undefined) { return { kind: "ineligible", reason }; }
  if (entry.kind !== "ready" || entry.settings.shared === undefined) { return { kind: "notShared" }; }
  if (!connection) { return { kind: "shared", connected: false }; }
  const problem = deriveConnectionProblem(connection);
  return { kind: "shared", connected: connection.state().status === "open", ...(problem === undefined ? {} : { problem }) };
}

const LOG_MODULE = "library-ui.sharing";
const UNKNOWN = "This project is not in the open library.";
const BUSY = "This shared project is busy; try again in a moment.";
const NOT_SHARED = "This project is not shared.";
const NOT_CONNECTED = "Connect this shared project before handing out its invite.";

export interface ProjectShareDeps {
  ports: ShareFlowPorts;
  /** The project's key on every surface: its folder. */
  idOf(entry: ProjectEntry): string;
  open(entry: ProjectEntry): Promise<void>;
}

export type ProjectShareOps = Pick<
  ShareHost, "projects" | "projectStatus" | "shareProject" | "inviteLink" | "joinProject" | "leaveProject" | "openProject"
>;

async function shareEntry(ports: ShareFlowPorts, entry: ProjectEntry, signal: AbortSignal): Promise<ShareProjectResult> {
  const reason = deriveIneligibleReason(entry);
  if (reason !== undefined || entry.kind !== "ready") { throw new Error(reason ?? UNKNOWN); }
  const { shared } = entry.settings;
  if (shared !== undefined && ports.shares.isBusy(shared)) { throw new Error(BUSY); }
  const outcome = await startProjectShare(ports, { folder: entry.folder, shared, signal });
  return outcome.kind === "shared" ? { kind: "shared", invite: outcome.invite } : { kind: outcome.kind };
}

async function joinProject({ ports, idOf }: ProjectShareDeps, logger: ILogger, invite: string, signal: AbortSignal): Promise<JoinProjectResult> {
  let folder: string | undefined;
  try {
    const outcome = await joinSharedProject(ports, invite, signal);
    if (outcome.kind === "refused") { return outcome; }
    folder = outcome.folder;
    // INVARIANT: the join workflow reloads the catalog, so the joined folder is listed once it resolves.
    const entry = ports.projects.list().find((candidate) => candidate.folder === outcome.folder);
    if (!entry) { throw new Error("LabShelf joined the share but cannot find its project in the open library."); }
    return { kind: outcome.kind, id: idOf(entry), name: deriveProjectName(entry) };
  } catch (error) {
    void logger.error(LOG_MODULE, error, { op: "joinProject", folder });
    throw error;
  }
}

export function createProjectShareOps({ ports, idOf, open }: ProjectShareDeps, logger: ILogger): ProjectShareOps {
  const find = (id: string) => ports.projects.list().find((entry) => idOf(entry) === id);

  /** Runs `run` on the project with this id, logging and rethrowing a failure with what it was acting on. */
  async function act<T>(op: string, id: string, run: (entry: ProjectEntry) => Promise<T>): Promise<T> {
    const entry = find(id);
    try {
      if (!entry) { throw new Error(UNKNOWN); }
      return await run(entry);
    } catch (error) {
      const shareId = entry?.kind === "ready" ? entry.settings.shared : undefined;
      void logger.error(LOG_MODULE, error, { op, folder: entry?.folder, shareId });
      throw error;
    }
  }

  function requireShared(entry: ProjectEntry): SharedProject {
    if (!isSharedProject(entry)) { throw new Error(deriveIneligibleReason(entry) ?? NOT_SHARED); }
    if (ports.shares.isBusy(entry.settings.shared)) { throw new Error(BUSY); }
    return entry;
  }

  return {
    projects: async () => ports.projects.list()
      .filter((entry) => entry.kind === "ready" && !entry.settings.trashed)
      .map((entry) => ({ id: idOf(entry), name: deriveProjectName(entry), shared: isSharedProject(entry) })),
    projectStatus: async (id) => {
      const entry = find(id);
      if (!entry) { return { kind: "ineligible", reason: UNKNOWN }; }
      const shareId = entry.kind === "ready" ? entry.settings.shared : undefined;
      return deriveProjectShare(entry, shareId === undefined ? undefined : ports.shares.active(shareId));
    },
    shareProject: (id, signal) => act("shareProject", id, (entry) => shareEntry(ports, entry, signal)),
    inviteLink: (id) => act("inviteLink", id, async (entry) => {
      const connection = isSharedProject(entry) ? ports.shares.active(entry.settings.shared) : undefined;
      if (!connection) { throw new Error(NOT_CONNECTED); }
      requireShared(entry);
      return readCurrentInvite(ports, connection);
    }),
    joinProject: (invite, signal) => joinProject({ ports, idOf, open }, logger, invite, signal),
    leaveProject: (id) => act("leaveProject", id, async (entry) => {
      const shared = requireShared(entry);
      await leaveSharedProject(ports, { folder: shared.folder, shareId: shared.settings.shared });
    }),
    openProject: (id) => act("openProject", id, open),
  };
}

export interface FolderShareLinkDeps {
  papers(): readonly PaperRecord[];
  papersRoot: string;
  sep: string;
  sources: FolderShareSources;
  registry: ShareRegistryStore;
  relay: { require(): Promise<RelayAccount | undefined>; connected(): Promise<RelayAccount | undefined> };
  /** Apps pass core resolveRelayBackend; tests pass a memory relay. */
  backendFor(account: RelayAccount | undefined): (relayUrl: string) => ShareBackend;
  readerFor(relayUrl: string): ShareReader;
  importLink(options: Pick<ImportShareLinkOptions, "text" | "readerFor" | "onProgress">): Promise<ImportShareLinkResult>;
  refresh(): Promise<void>;
  openFolder(path: string): Promise<void>;
}

export type FolderShareLinkOps = Pick<ShareHost, "shareableFolder" | "shareFolder" | "sharedLinks" | "revokeLink" | "importLink" | "openFolder">;

const MODULE = "share";

// The RPC guard checks only argument shapes, so every path is checked here against the host's own library.
export function createFolderShareLinkOps(deps: FolderShareLinkDeps, logger: ILogger): FolderShareLinkOps {
  const eligible = (path: string) => listShareableFolders(deps.papers(), deps.papersRoot, deps.sep).find((folder) => folder.dir === path);

  const importResult = async (result: ImportShareLinkResult): Promise<ShareLinkImportResult> => {
    if (result.status === "refused") { return { kind: "failed", message: describeRefusedShareLink(result.error) }; }
    if (result.status === "openFailed") { return { kind: "failed", message: OPEN_SHARE_FAILURE[result.error] }; }
    const { summary, withAnnotations } = result;
    if (summary.added.length > 0) { await deps.refresh(); }
    const text = describeSharedImport(summary, summary.folder ? deps.sources.paths.basename(summary.folder) : "", withAnnotations);
    return summary.folder === undefined ? { kind: "imported", summary: text } : { kind: "imported", summary: text, folder: summary.folder };
  };

  return {
    shareableFolder: async (path) => {
      const folder = eligible(path);
      return folder && { path: folder.dir, label: folder.label, count: folder.count };
    },
    shareFolder: async (path, withAnnotations, onProgress) => {
      if (!eligible(path)) { throw new Error("This folder holds no papers to share."); }
      const account = await deps.relay.require();
      if (!account) { return { kind: "noRelay" }; }
      const papers = deps.papers();
      try {
        const link = await createShareLink({
          papers, folder: path, withAnnotations, sources: deps.sources, relayUrl: account.relayUrl, backendFor: deps.backendFor(account),
          registry: deps.registry, logger, onStage: (stage) => onProgress({ stage }),
        });
        return { kind: "shared", link };
      } catch (error) {
        await logger.error(MODULE, error, { action: "shareFolder", folder: path, papers: papers.length, relayUrl: account.relayUrl });
        throw error;
      }
    },
    sharedLinks: async () => {
      const { shares } = await loadShareRegistry(deps.registry);
      return [...shares]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((record) => ({ id: record.id, folder: record.folder, link: deriveShareLinkOfEntry(record), createdAt: record.createdAt, relayHost: new URL(record.relayUrl).host }));
    },
    revokeLink: async (id) => removeShare(id, { registry: deps.registry, backendFor: deps.backendFor(await deps.relay.connected()), logger }),
    importLink: async (text, onProgress) =>
      importResult(await deps.importLink({ text, readerFor: deps.readerFor, onProgress: (done, total) => onProgress({ done, total }) })),
    openFolder: async (path) => {
      if (path !== deps.papersRoot && !isUnderDir(path, deps.papersRoot, deps.sep)) { throw new Error("This folder is outside the library."); }
      await deps.openFolder(path);
    },
  };
}

export interface ShareHostDeps {
  /** Where the app keeps its list of links, in the user's words: "this device" or "this browser". */
  place: string;
  logger: ILogger;
  /** Absent where the app does not share projects; the dialogs then offer no project control. */
  projects?: ProjectShareDeps;
  /** Absent where the app does not share folders as links. */
  links?: FolderShareLinkDeps;
  clipboard: { write(text: string): Promise<void> };
  openLink(url: string): Promise<void>;
}



function refuse(what: string): () => Promise<never> {
  return () => Promise.reject(new Error(`This app does not share ${what}.`));
}

const NO_PROJECTS: ProjectShareOps = {
  projects: refuse("projects"), projectStatus: refuse("projects"), shareProject: refuse("projects"), inviteLink: refuse("projects"),
  joinProject: refuse("projects"), leaveProject: refuse("projects"), openProject: refuse("projects"),
};

const NO_LINKS: FolderShareLinkOps = {
  shareableFolder: refuse("folders as links"), shareFolder: refuse("folders as links"), sharedLinks: refuse("folders as links"),
  revokeLink: refuse("folders as links"), importLink: refuse("folders as links"), openFolder: refuse("folders as links"),
};

export function createShareHost(deps: ShareHostDeps): ShareHost {
  const { logger } = deps;
  const offers = { projects: deps.projects !== undefined, links: deps.links !== undefined };
  return {
    place: deps.place,
    offers: () => offers,
    // The halves an app runs are fixed when it builds the host.
    onOffersChange: () => () => undefined,
    ...(deps.projects ? createProjectShareOps(deps.projects, logger) : NO_PROJECTS),
    ...(deps.links ? createFolderShareLinkOps(deps.links, logger) : NO_LINKS),
    async copyText(text) {
      try {
        await deps.clipboard.write(text);
        return true;
      } catch (error) {
        await logger.log("WARN", LOG_MODULE, "The clipboard refused a copy", { error: String(error) });
        return false;
      }
    },
    async openLink(url) {
      const protocol = URL.canParse(url) ? new URL(url).protocol : "";
      if (protocol !== "https:" && protocol !== "http:") throw new Error("LabShelf opens only web links.");
      await deps.openLink(url);
    },
  };
}

/** Where the user keeps LabShelf open: a VS Code window or a browser page. */
export type NoticePlace = "window" | "page";

/**
 * Returns the check to run after every change of the shares' state. An episode starts when a share's persistence
 * failure appears and ends when it clears, so a run of failed writes gives one notice.
 */
export function createStoreFailureNotices(
  ports: Pick<ShareFlowPorts, "shares" | "projects">, place: NoticePlace, notify: (message: string) => void,
): () => void {
  const failing = new Set<string>();
  return () => {
    const listed = new Set<string>();
    for (const share of ports.shares.list()) {
      listed.add(share.shareId);
      const failure = share.state().persistenceFailure;
      if (failure === undefined) { failing.delete(share.shareId); continue; }
      if (failing.has(share.shareId)) { continue; }
      failing.add(share.shareId);
      const entry = ports.projects.list().find((candidate) => candidate.folder === share.folder);
      const title = entry ? deriveProjectName(entry) : share.folder.split(/[\\/]/).filter(Boolean).pop() ?? share.folder;
      notify(`Edits to "${title}" cannot be stored on this device: ${failure}. Keep this ${place} open until it is fixed; `
        + "the other members still receive your edits while you are connected.");
    }
    for (const shareId of failing) { if (!listed.has(shareId)) { failing.delete(shareId); } }
  };
}
