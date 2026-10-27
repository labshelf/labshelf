// Registers the collaboration commands (share, join and leave a project, offer and withdraw the owner's relay), shows the sharing status bar item, and declares what they share on the desktop and how they report a failure.
import * as path from "node:path";
import * as vscode from "vscode";

import {
  deriveConnectionProblem,
  formatError,
  offerOwnRelay,
  removeOwnRelayOffer,
  type ILogger,
  type OwnRelayOffer,
  type ProjectEntry,
  type RelayAccountStore,
  type ShareConnection,
  type ShareDialogRequest,
  type ShareFlowPorts,
} from "@labshelf/core";
import { sharingWebviews } from "../../share/index.js";
import { CONNECT_RELAY_COMMAND } from "../../relay/node/index.js";
import { readActiveProject, type WritingProjects } from "../../writing/index.js";
import type { SharedEditors } from "./editors.js";
import type { ActiveShares } from "./session.js";

const LOG_MODULE = "collab";

export interface CollabHost {
  /** The open library's folder, or undefined when none is open. */
  libraryRoot(): string | undefined;
  /** Offers the library setup when none is open; resolves to the library folder or undefined. */
  requireLibrary(): Promise<string | undefined>;
  /** Logs to the open library's logger, whichever library that is at the time. */
  logger: ILogger;
  projects: WritingProjects;
  shares: ActiveShares;
  editors: SharedEditors;
  /** The owner's Cloudflare relay, when this device connected one. */
  relay: RelayAccountStore;
  /** What the core share, join, resume and leave workflows run on in this window. */
  ports: ShareFlowPorts;
}

/** The name a project goes by in messages. */
export const formatProjectName = (project: { settings: { id: string; title?: string | undefined } }): string => project.settings.title ?? project.settings.id;

/** Logs the failure with its context and shows it without waiting, so a command never blocks on the toast. */
export function reportFailure(logger: ILogger, action: string, error: unknown, context: Record<string, unknown> = {}): void {
  void logger.error(LOG_MODULE, error, { action, ...context });
  void vscode.window.showErrorMessage(`LabShelf could not ${action}: ${formatError(error)}`);
}

/** Shows a refused offer of the owner's relay; the workflow logged it already. */
export function showRefusedOffer(offer: OwnRelayOffer): void {
  if (offer.kind !== "refused") { return; }
  void vscode.window.showWarningMessage(`Your relay did not take the project, so it syncs without it: ${formatError(offer.error)}`);
}

const SHARE_COMMAND = "labshelf.collab.share";
export const JOIN_COMMAND = "labshelf.collab.join";
const LEAVE_COMMAND = "labshelf.collab.leave";

/** A folder path or a project entry from a view names the project; anything else, such as a URI from a menu, names none. */
function projectFolder(target: unknown): string | undefined {
  if (typeof target === "string") { return target; }
  if (typeof target !== "object" || target === null || !("folder" in target)) { return undefined; }
  const { folder } = target as { folder: unknown };
  return typeof folder === "string" ? folder : undefined;
}

const projectRequest = (kind: "shareProject" | "leaveProject", target: unknown): ShareDialogRequest => {
  const projectId = projectFolder(target);
  return projectId === undefined ? { kind } : { kind, projectId };
};

/** `requireLibrary` offers the library setup when none is open and resolves to undefined when the user declines. */
export function registerProjectDialogCommands(requireLibrary: () => Promise<string | undefined>): vscode.Disposable {
  const open = async (request: ShareDialogRequest): Promise<void> => {
    if (await requireLibrary()) { await sharingWebviews.open(request); }
  };
  return vscode.Disposable.from(
    vscode.commands.registerCommand(SHARE_COMMAND, (target?: unknown) => open(projectRequest("shareProject", target))),
    vscode.commands.registerCommand(JOIN_COMMAND, (invite?: unknown) => open(typeof invite === "string" ? { kind: "joinProject", invite } : { kind: "joinProject" })),
    vscode.commands.registerCommand(LEAVE_COMMAND, (target?: unknown) => open(projectRequest("leaveProject", target))),
  );
}

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;
/** A project folder path (from a script or another command) or a project entry (from a view). */
type ProjectSubmission = string | ProjectEntry | undefined;

async function pickProject(
  projects: Pick<WritingProjects, "list" | "paths">, target: ProjectSubmission, filter: (project: ReadyProject) => boolean, placeHolder: string,
): Promise<ReadyProject | undefined> {
  const ready = projects.list().filter((entry): entry is ReadyProject => entry.kind === "ready" && filter(entry));
  if (typeof target === "string") { return ready.find((entry) => entry.folder === path.resolve(target)); }
  if (target) { return ready.find((entry) => entry.folder === target.folder); }
  const active = readActiveProject(projects);
  if (active && filter(active)) { return active; }
  if (ready.length === 0) { return undefined; }
  const picked = await vscode.window.showQuickPick(
    ready.map((project) => ({ label: formatProjectName(project), description: project.folder, project })), { placeHolder },
  );
  return picked?.project;
}

export const OFFER_RELAY_COMMAND = "labshelf.relay.offer";
export const WITHDRAW_RELAY_COMMAND = "labshelf.relay.withdraw";

async function pickShare(host: CollabHost, placeHolder: string): Promise<{ share: ShareConnection; name: string } | undefined> {
  const connected = (shareId: string | undefined) => shareId !== undefined && host.shares.active(shareId) !== undefined;
  const project = await pickProject(host.projects, undefined, (entry) => connected(entry.settings.shared), placeHolder);
  const share = project?.settings.shared ? host.shares.active(project.settings.shared) : undefined;
  if (!project || !share) {
    void vscode.window.showInformationMessage("No shared project is connected in this window.");
    return undefined;
  }
  return { share, name: formatProjectName(project) };
}

/** The relay of the connected Cloudflare account; undefined, with an offer to connect, when there is none. */
async function ownRelayUrl(host: CollabHost): Promise<string | undefined> {
  const account = await host.relay.get();
  if (account) { return account.relayUrl; }
  const connect = "Connect Cloudflare";
  void vscode.window.showInformationMessage("Connect Cloudflare first to have a relay to offer.", connect).then((choice) => {
    if (choice === connect) { void vscode.commands.executeCommand(CONNECT_RELAY_COMMAND); }
  });
  return undefined;
}

export async function offerRelay(host: CollabHost): Promise<void> {
  const relayUrl = await ownRelayUrl(host);
  const picked = relayUrl && (await pickShare(host, "Shared project to offer your relay to"));
  if (!picked) { return; }
  try {
    const offer = await offerOwnRelay(host.ports, picked.share);
    showRefusedOffer(offer);
    if (offer.kind === "offered" || offer.kind === "listed") {
      void vscode.window.showInformationMessage(`Offered your relay at ${relayUrl} to "${picked.name}".`);
    }
  } catch (error) {
    reportFailure(host.logger, `offer your relay to "${picked.name}"`, error, { shareId: picked.share.shareId, relayUrl });
  }
}

export async function leaveRelay(host: CollabHost): Promise<void> {
  const relayUrl = await ownRelayUrl(host);
  const picked = relayUrl && (await pickShare(host, "Shared project to withdraw your relay from"));
  if (!picked) { return; }
  try {
    const removed = await removeOwnRelayOffer(host.ports, picked.share, relayUrl);
    void vscode.window.showInformationMessage(removed ? `Withdrew your relay from "${picked.name}".` : `"${picked.name}" does not list a relay you offered.`);
  } catch (error) {
    reportFailure(host.logger, `withdraw your relay from "${picked.name}"`, error, { shareId: picked.share.shareId, relayUrl });
  }
}

const MANAGE_COMMAND = "labshelf.collab.manage";
const STATUS_COMMAND = "labshelf.collab.status";

/** The share of the active editor's file, else the first connected one. */
function currentShare(host: CollabHost): ShareConnection | undefined {
  const document = vscode.window.activeTextEditor?.document;
  const shares = host.shares.list();
  const inFolder = document?.uri.scheme === "file" ? shares.find((share) => document.uri.fsPath.startsWith(share.folder + path.sep)) : undefined;
  return (document && host.editors.of(document)?.share) ?? inFolder ?? shares[0];
}

/** A workers.dev relay goes by its account subdomain, any other by its host. */
function relayName(url: string): string {
  const host = new URL(url).hostname;
  return /^[^.]+\.([^.]+)\.workers\.dev$/.exec(host)?.[1] ?? host;
}

function describeRelays(share: ShareConnection): { text: string; tooltip: string } {
  const listed = share.relays.list();
  if (listed.length === 0) { return { text: "", tooltip: "" }; }
  const { current } = share.relays;
  const lines = listed.map(({ url, downUntil }) => {
    const mark = url === current ? " (in use)" : downUntil ? ` (down until ${new Date(downUntil).toLocaleTimeString()})` : "";
    return `\n- ${url}${mark}`;
  });
  const use = current ? ` Edits also sync through the relay at ${current}.` : " None of the project's relays answers, so edits sync only directly.";
  return { text: current ? ` · via ${relayName(current)}` : "", tooltip: `${use}\nRelays, in the order collaborators try them:${lines.join("")}\n` };
}

function describe(share: ShareConnection): { text: string; tooltip: string } {
  const online = share.session.peers.length;
  const relay = describeRelays(share);
  if (share.session.status === "closed" || online === 0) {
    return { text: `$(broadcast) Shared · offline${relay.text}`, tooltip: `No collaborator is connected. Edits sync when one opens the project.${relay.tooltip}` };
  }
  return { text: `$(broadcast) Shared · ${online} online${relay.text}`, tooltip: `${online} collaborator${online === 1 ? "" : "s"} connected.${relay.tooltip}` };
}

export function registerShareStatusBar(context: vscode.ExtensionContext, host: CollabHost): void {
  const item = vscode.window.createStatusBarItem("labshelf.collab", vscode.StatusBarAlignment.Left, 49);
  item.name = "LabShelf Sharing";
  item.command = MANAGE_COMMAND;
  const update = (): void => {
    const share = currentShare(host);
    if (!share) { item.hide(); return; }
    const { text, tooltip } = describe(share);
    const problem = deriveConnectionProblem(share);
    item.text = problem === undefined ? text : text.replace("$(broadcast)", "$(warning)");
    item.tooltip = `${problem === undefined ? "" : `${problem}\n`}${tooltip} Click to manage the project's sharing.`;
    item.backgroundColor = problem === undefined ? undefined : new vscode.ThemeColor("statusBarItem.errorBackground");
    item.show();
  };
  context.subscriptions.push(
    item,
    host.shares.onDidChange(update),
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.commands.registerCommand(MANAGE_COMMAND, async () => {
      const share = currentShare(host);
      if (share) { await sharingWebviews.open({ kind: "shareProject", projectId: share.folder }); }
    }),
    // For scripts and end-to-end runs: the connected shares as plain data.
    vscode.commands.registerCommand(STATUS_COMMAND, () => host.shares.list().map((share) => ({
      shareId: share.shareId, folder: share.folder, status: share.session.status, peers: share.session.peers.length,
      relayUrl: share.relays.current, relays: share.relays.list(),
    }))),
  );
  update();
}
