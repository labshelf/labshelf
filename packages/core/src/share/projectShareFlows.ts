/**
 * The workflows of a shared project: how a project becomes a share, how a member joins one into the library, and leaving it,
 * with the invite checks they share.
 */
import type { Doc } from "yjs";
import {
  parseProjectFile, PROJECT_FILE, updateProjectFile, type ProjectReadContext, createProjectId, type ProjectCatalogContext,
} from "../writing/project/index.js";
import {
  createShareIndexDoc, applySharedSettings, readShareIndexDocSettings, readShareIndexDocKind, readSettingsMap,
} from "../collab/index.js";
import { createLibraryLayout } from "../library/index.js";
import { createShareKey, deriveShareId, InviteWithoutRelayError, parseInvite, type Invite, type InviteError } from "../collab/invite/index.js";
import type { ShareConnection } from "../collab/session/index.js";
import { readCurrentInvite, offerOwnRelay, type OwnRelayOffer, LOG_MODULE, type ShareFlowPorts } from "./sharedProjects.js";

export interface StartShareRequest {
  folder: string;
  shareId: string;
  /** The new share's index doc. */
  index: Doc;
}

/**
 * Marks the index as a project's and writes `shared: <shareId>` into labshelf.yaml, keeping every other key and comment.
 * A project without a title gets its id as title, the name it shows already.
 */
export async function startShare({ fs, paths, logger }: ProjectReadContext, request: StartShareRequest): Promise<void> {
  const file = paths.join(request.folder, PROJECT_FILE);
  const text = await fs.readText(file);
  createShareIndexDoc(request.index);
  // `id` is per user and only `title` is shared, so without one a joiner's copy would get the slug fallback name.
  const parsed = parseProjectFile(text);
  const title = parsed.ok && parsed.settings.title === undefined ? { title: parsed.settings.id } : {};
  await fs.writeText(file, updateProjectFile(text, { ...title, shared: request.shareId }));
  await logger.log("INFO", "collab.share", "Shared a project", { folder: request.folder, shareId: request.shareId });
}

export interface JoinShareRequest {
  libraryRoot: string;
  shareId: string;
  /** The share's index doc, synced far enough to hold its kind and settings. */
  index: Doc;
}

export interface JoinedProject {
  id: string;
  folder: string;
}

/**
 * Creates `projects/<id>/` with a labshelf.yaml of the shared settings plus this member's `id` and `shared`, the id
 * taken from the shared title with the usual suffix on a collision. Throws for a share that is not a project.
 */
export async function joinShare(context: ProjectCatalogContext, request: JoinShareRequest): Promise<JoinedProject> {
  const { fs, paths, logger } = context;
  const kind = readShareIndexDocKind(request.index);
  if (!kind.ok) {
    throw new Error(kind.error === "missingShareKind" ? "The share names no kind" : `The share is a ${String(kind.kind)}, not a project`);
  }
  const settings = readSettingsMap(readShareIndexDocSettings(request.index));
  const title = typeof settings["title"] === "string" ? settings["title"] : "project";
  const id = await createProjectId(context, request.libraryRoot, title);
  const folder = paths.join(createLibraryLayout(request.libraryRoot, (base, ...segments) => paths.join(base, ...segments)).projectsRoot(), id);
  // INVARIANT: id and shareId are a slug and hex, so they need no YAML quoting.
  await fs.writeText(paths.join(folder, PROJECT_FILE), applySharedSettings(`id: ${id}\nshared: ${request.shareId}\n`, settings));
  await logger.log("INFO", "collab.share", "Created the project of a joined share", { folder, shareId: request.shareId });
  return { id, folder };
}

const DAMAGED = "This invite link is damaged. Ask for a new one.";

const INVITE_PROBLEMS: Record<InviteError, string> = {
  notAnInvite: "This is not a LabShelf invite link.",
  unsupportedVersion: "This invite comes from a newer LabShelf. Update LabShelf and try again.",
  badShareId: DAMAGED,
  badKey: DAMAGED,
  badRelayList: DAMAGED,
  shareIdMismatch: DAMAGED,
};

export type CheckedInvite = { ok: true; invite: Invite } | { ok: false; problem: string };

/** Accepts only an invite that parses, whose id derives from its key, and that lists a relay to reach the share through. */
export async function checkInvite(text: string): Promise<CheckedInvite> {
  const parsed = await parseInvite(text);
  if (!parsed.ok) { return { ok: false, problem: INVITE_PROBLEMS[parsed.error] }; }
  if (parsed.invite.relays.length === 0) { return { ok: false, problem: new InviteWithoutRelayError().message }; }
  return { ok: true, invite: parsed.invite };
}

export interface ShareRequest {
  folder: string;
  /** The project's `shared` field; set when it is shared already. */
  shared: string | undefined;
  signal: AbortSignal;
}

export type ShareOutcome =
  | { kind: "shared"; invite: string; connection: ShareConnection; offer: OwnRelayOffer }
  /** No relay is connected and the user did not connect one; nothing was published. */
  | { kind: "noRelay" }
  /** The project is shared, but this device holds no key of it. */
  | { kind: "noKey" };

interface Offered { connection: ShareConnection; offer: OwnRelayOffer }

export async function startProjectShare(ports: ShareFlowPorts, request: ShareRequest): Promise<ShareOutcome> {
  const shared = request.shared === undefined ? await shareNew(ports, request) : await reconnect(ports, request.folder, request.shared);
  if (shared === "noRelay" || shared === "noKey") { return { kind: shared }; }
  return { kind: "shared", invite: await readCurrentInvite(ports, shared.connection), ...shared };
}

async function reconnect(ports: ShareFlowPorts, folder: string, shareId: string): Promise<Offered | "noKey"> {
  const stored = await ports.keys.invite(shareId);
  if (!stored) { return "noKey"; }
  const connection = await ports.shares.hold(shareId, async () => {
    const active = ports.shares.active(shareId);
    if (active) { return active; }
    const resumed = await ports.connect(stored, { mode: "resume", folder });
    ports.shares.add(resumed);
    return resumed;
  });
  return { connection, offer: await offerOwnRelay(ports, connection) };
}

async function shareNew(ports: ShareFlowPorts, { folder, signal }: ShareRequest): Promise<Offered | "noRelay"> {
  // INVARIANT: nothing is published before a relay exists, since a joiner reaches the share only through one.
  if (!(await ports.relay.get()) && !((await ports.requireRelay()) && (await ports.relay.get()))) {
    void ports.logger.log("INFO", LOG_MODULE, "Sharing cancelled: no relay is connected", { folder });
    return "noRelay";
  }
  if (signal.aborted) { throw new Error("Sharing was cancelled"); }
  const shareKey = createShareKey();
  const shareId = await deriveShareId(shareKey);
  const projectFile = ports.files.paths.join(folder, PROJECT_FILE);
  const original = await ports.files.fs.readText(projectFile);
  return ports.shares.hold(shareId, async () => {
    // The key is stored before connecting, so the project list reload that the new `shared` field causes finds it.
    await ports.keys.remember({ shareId, shareKey, relays: [] });
    try {
      const connection = await ports.connect({ shareId, shareKey, relays: [] }, { mode: "share", folder });
      ports.shares.add(connection);
      if (signal.aborted) { throw new Error("Sharing was cancelled"); }
      await ports.projects.reload();
      // A new share lists no other relay, so an invite without the owner's would reach nobody.
      const offer = await offerOwnRelay(ports, connection);
      if (offer.kind === "refused") { throw new Error(`Your relay refused the share: ${String(offer.error)}`, { cause: offer.error }); }
      void ports.logger.log("INFO", LOG_MODULE, "Shared a project", { folder, shareId });
      return { connection, offer };
    } catch (error) {
      await rollBack(ports, folder, shareId, original);
      throw error;
    }
  });
}

/** Undoes what a failed or cancelled share wrote; the share id is fresh, so all of it belongs to this operation. */
async function rollBack(ports: ShareFlowPorts, folder: string, shareId: string, original: string): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["close the connection", () => ports.shares.remove(shareId)],
    ["forget the key", () => ports.keys.forget(shareId)],
    ["restore labshelf.yaml", () => restoreProjectFile(ports, folder, shareId, original)],
    ["delete the share state", () => ports.deleteState(shareId)],
    ["reload the projects", () => ports.projects.reload()],
  ];
  for (const [action, step] of steps) {
    await step().catch((error: unknown) => ports.logger.error(LOG_MODULE, error, { action: `roll back a share: ${action}`, folder, shareId }));
  }
  void ports.logger.log("INFO", LOG_MODULE, "Rolled back a share that did not complete", { folder, shareId });
}

/** Puts back the text from before the share, which also drops the title the share added, unless the file names another share. */
async function restoreProjectFile(ports: ShareFlowPorts, folder: string, shareId: string, original: string): Promise<void> {
  const file = ports.files.paths.join(folder, PROJECT_FILE);
  const parsed = parseProjectFile(await ports.files.fs.readText(file));
  if (parsed.ok && parsed.settings.shared !== shareId) { return; }
  await ports.files.fs.writeText(file, original);
}

export type JoinOutcome =
  /** The invite cannot be joined; `problem` says why in words for the user. Nothing was created. */
  | { kind: "refused"; problem: string }
  /** `active`: connected already, nothing changed; `resumed`: a project of the share reconnected; `joined`: a project was created. */
  | { kind: "active" | "resumed" | "joined"; folder: string };

/** `signal` cancels a join that waits for a member to answer. */
export async function joinSharedProject(ports: ShareFlowPorts, inviteText: string, signal: AbortSignal): Promise<JoinOutcome> {
  // INVARIANT: the invite is checked in full before anything is written, so a bad one leaves no project behind.
  const checked = await checkInvite(inviteText);
  if (!checked.ok) {
    void ports.logger.log("WARN", LOG_MODULE, "Refused an invite", { problem: checked.problem });
    return { kind: "refused", problem: checked.problem };
  }
  const { invite } = checked;
  const { shareId } = invite;
  const active = ports.shares.active(shareId);
  if (active) { return { kind: "active", folder: active.folder }; }
  const known = ports.projects.list().find((entry) => entry.kind === "ready" && entry.settings.shared === shareId);
  return ports.shares.hold(shareId, async () => {
    const connection = await ports.connect(invite, known ? { mode: "resume", folder: known.folder } : { mode: "join", signal });
    ports.shares.add(connection);
    // The key is stored once the connection stands, so a failed join leaves no key of a project that does not exist.
    await ports.keys.remember(invite);
    await ports.projects.reload();
    void ports.logger.log("INFO", LOG_MODULE, known ? "Reconnected a shared project from its invite" : "Joined a shared project", { folder: connection.folder, shareId });
    return { kind: known ? "resumed" : "joined", folder: connection.folder };
  });
}

/** Removes `shared` from labshelf.yaml when it names this share, keeping every other key and comment. */
async function clearSharedField({ fs, paths }: ProjectReadContext, folder: string, shareId: string): Promise<void> {
  const file = paths.join(folder, PROJECT_FILE);
  const text = await fs.readText(file);
  const parsed = parseProjectFile(text);
  if (parsed.ok && parsed.settings.shared !== shareId) { return; }
  await fs.writeText(file, updateProjectFile(text, { shared: undefined }));
}

/**
 * The other members keep the share; nothing on the relay is deleted. When the connection cannot store its pending updates the
 * leave stops before anything is forgotten, so the key, the `shared` field and the stored state stay and a retry loses nothing.
 */
export async function leaveSharedProject(ports: ShareFlowPorts, project: { folder: string; shareId: string }): Promise<void> {
  const { folder, shareId } = project;
  await ports.shares.hold(shareId, async () => {
    try {
      await ports.shares.remove(shareId);
    } catch (error) {
      throw new Error(`The shared project in ${folder} could not store its last edits, so it stays shared: ${String(error)}`, { cause: error });
    }
    await ports.keys.forget(shareId);
    await clearSharedField(ports.files, folder, shareId);
    await ports.deleteState(shareId);
    await ports.projects.reload();
  });
  void ports.logger.log("INFO", LOG_MODULE, "Stopped sharing a project on this device", { folder, shareId });
}
