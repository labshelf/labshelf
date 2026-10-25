// Runs the project half of the sharing dialogs over the core share workflows, checking each project id against the open library.
import {
  currentInvite, isSharedProject, joinSharedProject, leaveSharedProject, shareProject, type SharedProject, type ShareWorkflowPorts,
} from "../../../collab/share/flows/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { ProjectEntry } from "../../../writing/project/index.js";
import type { JoinProjectResult, ShareHost, ShareProjectResult } from "../shareHost.js";
import { deriveIneligibleReason, deriveProjectName, deriveProjectShare } from "./projectShareState.js";

const LOG_MODULE = "library-ui.sharing";
const UNKNOWN = "This project is not in the open library.";
const BUSY = "This shared project is busy; try again in a moment.";
const NOT_SHARED = "This project is not shared.";
const NOT_CONNECTED = "Connect this shared project before handing out its invite.";

export interface ProjectShareDeps {
  ports: ShareWorkflowPorts;
  /** The project's key on every surface: its folder. */
  idOf(entry: ProjectEntry): string;
  open(entry: ProjectEntry): Promise<void>;
}

export type ProjectShareOps = Pick<
  ShareHost, "projects" | "projectStatus" | "shareProject" | "inviteLink" | "joinProject" | "leaveProject" | "openProject"
>;

async function shareEntry(ports: ShareWorkflowPorts, entry: ProjectEntry, signal: AbortSignal): Promise<ShareProjectResult> {
  const reason = deriveIneligibleReason(entry);
  if (reason !== undefined || entry.kind !== "ready") { throw new Error(reason ?? UNKNOWN); }
  const { shared } = entry.settings;
  if (shared !== undefined && ports.shares.isBusy(shared)) { throw new Error(BUSY); }
  const outcome = await shareProject(ports, { folder: entry.folder, shared, signal });
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
      return currentInvite(ports, connection);
    }),
    joinProject: (invite, signal) => joinProject({ ports, idOf, open }, logger, invite, signal),
    leaveProject: (id) => act("leaveProject", id, async (entry) => {
      const shared = requireShared(entry);
      await leaveSharedProject(ports, { folder: shared.folder, shareId: shared.settings.shared });
    }),
    openProject: (id) => act("openProject", id, open),
  };
}
