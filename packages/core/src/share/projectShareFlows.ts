/**
 * The workflows of a shared project or Space: how one becomes a share, how a member joins one into the library, and leaving a
 * project, with the invite checks they share.
 */
import type { Doc } from "yjs";
import {
  parseProjectFile, PROJECT_FILE, updateProjectFile, type ProjectReadContext, createProjectId, type ProjectCatalogContext,
} from "../writing/project/index.js";
import {
  createShareIndexDoc, applySharedSettings, readShareIndexDocSettings, readShareIndexDocKind, readSettingsMap,
} from "../collab/index.js";
import { createLibraryLayout } from "../library/index.js";
import { createShareKey, deriveShareId, InviteWithoutRelayError, parseInvite, type Invite, type InviteError } from "../collab/index.js";
import type { ShareConnection } from "../collab/session/index.js";
import type { ShareKind } from "../collab/index.js";
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
  badKey: DAMAGED,
  badRelayList: DAMAGED,
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
  /** The project's or Space's `shared` field; set when it is shared already. */
  shared: string | undefined;
  signal: AbortSignal;
}

export type ShareOutcome =
  | { kind: "shared"; invite: string; connection: ShareConnection; offer: OwnRelayOffer }
  /** No relay is connected and the user did not connect one; nothing was published. */
  | { kind: "noRelay" }
  /** The project or Space is shared, but this device holds no key of it. */
  | { kind: "noKey" };

interface Offered { connection: ShareConnection; offer: OwnRelayOffer }

/** What a share is on disk: the file whose `shared` field names it, and the catalog that lists it. */
export interface SharePlace {
  kind: ShareKind;
  /** labshelf.yaml or space.json; put back as it was when a share fails. */
  file: string;
  /** The share id the file's text names, if any. */
  sharedIn(text: string): string | undefined;
  reload(): Promise<void>;
}

export const projectPlace = (ports: ShareFlowPorts, folder: string): SharePlace => ({
  kind: "project",
  file: ports.files.paths.join(folder, PROJECT_FILE),
  sharedIn: (text) => { const parsed = parseProjectFile(text); return parsed.ok ? parsed.settings.shared : undefined; },
  reload: () => ports.projects.reload(),
});

export function startProjectShare(ports: ShareFlowPorts, request: ShareRequest): Promise<ShareOutcome> {
  return startPlaceShare(ports, projectPlace(ports, request.folder), request);
}

export async function startPlaceShare(ports: ShareFlowPorts, place: SharePlace, request: ShareRequest): Promise<ShareOutcome> {
  const shared = request.shared === undefined ? await shareNew(ports, place, request) : await reconnect(ports, place, request.folder, request.shared);
  if (shared === "noRelay" || shared === "noKey") { return { kind: shared }; }
  return { kind: "shared", invite: await readCurrentInvite(ports, shared.connection), ...shared };
}

async function reconnect(ports: ShareFlowPorts, place: SharePlace, folder: string, shareId: string): Promise<Offered | "noKey"> {
  const stored = await ports.keys.invite(shareId);
  if (!stored) { return "noKey"; }
  const connection = await ports.shares.hold(shareId, async () => {
    const active = ports.shares.active(shareId);
    if (active) { return active; }
    const resumed = await ports.connect(stored, { mode: "resume", folder, kind: place.kind });
    ports.shares.add(resumed);
    return resumed;
  });
  return { connection, offer: await offerOwnRelay(ports, connection) };
}

async function shareNew(ports: ShareFlowPorts, place: SharePlace, { folder, signal }: ShareRequest): Promise<Offered | "noRelay"> {
  // INVARIANT: nothing is published before a relay exists, since a joiner reaches the share only through one.
  if (!(await ports.relay.get()) && !((await ports.requireRelay()) && (await ports.relay.get()))) {
    void ports.logger.log("INFO", LOG_MODULE, "Sharing cancelled: no relay is connected", { folder });
    return "noRelay";
  }
  if (signal.aborted) { throw new Error("Sharing was cancelled"); }
  const shareKey = createShareKey();
  const shareId = await deriveShareId(shareKey);
  const original = await ports.files.fs.readText(place.file);
  return ports.shares.hold(shareId, async () => {
    // The key is stored before connecting, so the list reload that the new `shared` field causes finds it.
    await ports.keys.remember({ shareId, shareKey, relays: [] });
    try {
      const connection = await ports.connect({ shareId, shareKey, relays: [] }, { mode: "share", folder, kind: place.kind });
      ports.shares.add(connection);
      if (signal.aborted) { throw new Error("Sharing was cancelled"); }
      await place.reload();
      // A new share lists no other relay, so an invite without the owner's would reach nobody.
      const offer = await offerOwnRelay(ports, connection);
      if (offer.kind === "refused") { throw new Error(`Your relay refused the share: ${String(offer.error)}`, { cause: offer.error }); }
      void ports.logger.log("INFO", LOG_MODULE, `Shared a ${place.kind}`, { folder, shareId });
      return { connection, offer };
    } catch (error) {
      await rollBack(ports, place, folder, shareId, original);
      throw error;
    }
  });
}

/** Undoes what a failed or cancelled share wrote; the share id is fresh, so all of it belongs to this operation. */
async function rollBack(ports: ShareFlowPorts, place: SharePlace, folder: string, shareId: string, original: string): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["close the connection", () => ports.shares.remove(shareId)],
    ["forget the key", () => ports.keys.forget(shareId)],
    ["restore the shared file", () => restoreSharedFile(ports, place, shareId, original)],
    ["delete the share state", () => ports.deleteState(shareId)],
    ["reload the list", () => place.reload()],
  ];
  for (const [action, step] of steps) {
    await step().catch((error: unknown) => ports.logger.error(LOG_MODULE, error, { action: `roll back a share: ${action}`, folder, shareId }));
  }
  void ports.logger.log("INFO", LOG_MODULE, "Rolled back a share that did not complete", { folder, shareId });
}

/** Puts back the text from before the share, which also drops the title the share added, unless the file names another share. */
async function restoreSharedFile(ports: ShareFlowPorts, place: SharePlace, shareId: string, original: string): Promise<void> {
  const shared = place.sharedIn(await ports.files.fs.readText(place.file));
  if (shared !== undefined && shared !== shareId) { return; }
  await ports.files.fs.writeText(place.file, original);
}

export type JoinOutcome =
  /** The invite cannot be joined; `problem` says why in words for the user. Nothing was created. */
  | { kind: "refused"; problem: string }
  /**
   * `active`: connected already, nothing changed; `resumed`: a project or Space of the share reconnected; `joined`: one was created.
   * `place` says which of the two the share is.
   */
  | { kind: "active" | "resumed" | "joined"; folder: string; place: ShareKind };

/** `signal` cancels a join that waits for a member to answer. */
export async function joinSharedProject(ports: ShareFlowPorts, inviteText: string, signal: AbortSignal): Promise<JoinOutcome> {
  // INVARIANT: the invite is checked in full before anything is written, so a bad one leaves no project behind.
  const checked = await checkInvite(inviteText);
  if (!checked.ok) {
    void ports.logger.log("WARN", LOG_MODULE, "Refused an invite", { problem: checked.problem });
    return { kind: "refused", problem: checked.problem };
  }
  return joinInvite(ports, checked.invite, signal);
}

/** Joins or reconnects the share of an invite already checked, from a link or an opened invitation. */
export async function joinInvite(ports: ShareFlowPorts, invite: Invite, signal: AbortSignal): Promise<JoinOutcome> {
  const { shareId } = invite;
  const active = ports.shares.active(shareId);
  if (active) { return { kind: "active", folder: active.folder, place: active.kind }; }
  const project = ports.projects.list().find((entry) => entry.kind === "ready" && entry.settings.shared === shareId);
  const space = ports.spaces?.list().find((entry) => entry.shared === shareId);
  const known = project ? { folder: project.folder, kind: "project" as const } : space ? { folder: space.folder, kind: "space" as const } : undefined;
  return ports.shares.hold(shareId, async () => {
    const connection = await ports.connect(invite, known ? { mode: "resume", ...known } : { mode: "join", signal });
    ports.shares.add(connection);
    // The key is stored once the connection stands, so a failed join leaves no key of a project that does not exist.
    await ports.keys.remember(invite);
    await (connection.kind === "space" ? ports.spaces?.reload() : ports.projects.reload());
    void ports.logger.log("INFO", LOG_MODULE, known ? `Reconnected a shared ${connection.kind} from its invite` : `Joined a shared ${connection.kind}`, { folder: connection.folder, shareId });
    return { kind: known ? "resumed" : "joined", folder: connection.folder, place: connection.kind };
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
