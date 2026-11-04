// Runs live Space shares on the desktop: the Space list the share workflows see, the sync beside each connected Space share,
// and the share, leave and download actions of the Space pages with their progress, prompts and notices.
import * as vscode from "vscode";

import {
  attachSpaceShare,
  createPaperFiles,
  createSpaceShareOps,
  type DownloadSpacePapersOutcome,
  type ShareConnection,
  type ShareFlowPorts,
  type SharedSpaceCatalog,
  type SpaceShareDeps,
  type SpaceShareOps,
} from "@labshelf/core";
import type { ActiveServices } from "../../command/index.js";
import type { SpaceSharingHost, SpacesService } from "../../spaces/index.js";
import type { WritingProjects } from "../../writing/index.js";
import { JOIN_COMMAND, reportFailure } from "./commands.js";
import type { ActiveShares } from "./session.js";

/** The Spaces of the open library as the extension's Spaces service holds them. */
export type SpaceSource = Pick<SpacesService, "current" | "onDidChangeSpaces" | "provideSharing">;

/** Readable Spaces, Trash included, each with its absolute `spaces/<id>` folder. */
export function createSharedSpaceCatalog(source: Pick<SpaceSource, "current">): SharedSpaceCatalog {
  return {
    list: () => {
      const active = source.current();
      if (!active) { return []; }
      return active.store.list().flatMap((row) => row.state === "ready"
        ? [{ id: row.space.id, name: row.space.name, folder: active.spaceDir(row.space.id), ...(row.space.shared === undefined ? {} : { shared: row.space.shared }) }]
        : []);
    },
    reload: async () => { await source.current()?.store.reload(); },
  };
}

export interface SpaceShareHostDeps {
  /** Built after the shares; read only once a share connects or a page acts. */
  ports(): ShareFlowPorts;
  spaces: SpaceSource;
  services(): ActiveServices | undefined;
  projects: Pick<WritingProjects, "onDidChange">;
  shares: Pick<ActiveShares, "onDidChange">;
}

/** What a Space share runs on in the library open now; undefined with no library open. */
export function createSpaceShareDeps(deps: SpaceShareHostDeps): SpaceShareDeps | undefined {
  const active = deps.spaces.current();
  const services = deps.services();
  if (!active || !services) { return undefined; }
  const { library, mutations } = services;
  return {
    ports: deps.ports(),
    spaces: active.store,
    papers: () => library.snapshot.papers,
    onPapersChange: (listener) => library.onChange(() => listener()),
    onProjectsChange: (listener) => {
      const subscription = deps.projects.onDidChange(() => listener());
      return () => subscription.dispose();
    },
    readPdf: async (paperId) => {
      const record = library.snapshot.papers.get(paperId)?.record;
      if (!record || record.hasPdf === false) { return undefined; }
      try {
        return await mutations.fs.readFile(createPaperFiles(record.path, mutations.paths.join).pdf);
      } catch {
        // A PDF missing on this device is served by another member, if any holds it.
        return undefined;
      }
    },
  };
}

/** Starts the Space sync beside a connected Space share; disposing stops it. A project share gets nothing. */
export function attachSpaceShareOf(share: ShareConnection, deps: () => SpaceShareDeps | undefined): vscode.Disposable {
  if (share.kind !== "space") { return new vscode.Disposable(() => undefined); }
  const shareDeps = deps();
  if (!shareDeps) { return new vscode.Disposable(() => undefined); }
  return new vscode.Disposable(attachSpaceShare(share, shareDeps));
}

const nameOf = (ports: ShareFlowPorts, spaceId: string): string => ports.spaces?.list().find((space) => space.id === spaceId)?.name ?? spaceId;

function describeDownload({ added, present, missingPdfs }: DownloadSpacePapersOutcome): string {
  const parts = [`${added.length} paper${added.length === 1 ? "" : "s"} added`];
  if (present.length > 0) { parts.push(`${present.length} already in the library`); }
  if (missingPdfs.length > 0) { parts.push(`${missingPdfs.length} without the PDF, since no member could send it: ${missingPdfs.join(", ")}`); }
  return `${parts.join("; ")}.`;
}

/** The library folders a download can go into: papers/ and each folder under it. */
async function pickDestination(services: ActiveServices): Promise<string | undefined> {
  const { papersRoot, paths } = services.mutations;
  const items = [...services.library.snapshot.collections.keys()].sort().map((rel) => ({
    label: rel === "" ? "Library" : rel,
    dir: rel === "" ? papersRoot : paths.join(papersRoot, ...rel.split("/")),
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Library folder to download the papers into" });
  return picked?.dir;
}

/** The share actions of the Space pages over the shares of this window. */
export function createSpaceSharingHost(deps: SpaceShareHostDeps): SpaceSharingHost {
  const logger = () => deps.ports().logger;
  const ops = (): { ops: SpaceShareOps; services: ActiveServices } => {
    const services = deps.services();
    const shareDeps = createSpaceShareDeps(deps);
    if (!services || !shareDeps) { throw new Error("No library is open."); }
    return { ops: createSpaceShareOps(shareDeps, () => services.mutations), services };
  };
  return {
    spaceShareState: (spaceId) => {
      const shareDeps = createSpaceShareDeps(deps);
      const services = deps.services();
      return shareDeps && services ? createSpaceShareOps(shareDeps, () => services.mutations).status(spaceId) : { shared: false, connected: false };
    },
    onSpaceShareChange: (listener) => {
      const subscriptions = [deps.shares.onDidChange(listener), deps.spaces.onDidChangeSpaces(() => listener())];
      return () => subscriptions.forEach((subscription) => subscription.dispose());
    },
    shareSpace: async (spaceId) => {
      const name = nameOf(deps.ports(), spaceId);
      const aborted = new AbortController();
      try {
        const outcome = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Sharing the Space "${name}"…`, cancellable: true },
          (_progress, token) => {
            token.onCancellationRequested(() => aborted.abort());
            return ops().ops.share(spaceId, aborted.signal);
          },
        );
        if (outcome.kind === "shared") {
          const copy = "Copy Invite Link";
          const choice = await vscode.window.showInformationMessage(`The Space "${name}" is shared. Send its invite link to the people you share it with.`, copy);
          if (choice === copy) { await vscode.env.clipboard.writeText(outcome.invite); }
        } else if (outcome.kind === "noKey") {
          const join = "Join";
          const choice = await vscode.window.showWarningMessage(`This device has no key of the shared Space "${name}". Paste its invite to reconnect.`, join);
          if (choice === join) { await vscode.commands.executeCommand(JOIN_COMMAND); }
        }
        // noRelay: the relay prompt the workflow showed is the whole answer.
      } catch (error) {
        if (aborted.signal.aborted) { return; }
        reportFailure(logger(), `share the Space "${name}"`, error, { spaceId });
      }
    },
    leaveSpace: async (spaceId) => {
      const name = nameOf(deps.ports(), spaceId);
      const leave = "Stop Sharing";
      const choice = await vscode.window.showWarningMessage(`Stop sharing the Space "${name}" on this device?`, {
        modal: true, detail: "The other members keep the Space, and its files stay here. Its projects stay shared.",
      }, leave);
      if (choice !== leave) { return; }
      try {
        await ops().ops.leave(spaceId);
        void vscode.window.showInformationMessage(`The Space "${name}" is no longer shared on this device.`);
      } catch (error) {
        reportFailure(logger(), `stop sharing the Space "${name}"`, error, { spaceId });
      }
    },
    downloadSpacePapers: async (spaceId, what) => {
      const name = nameOf(deps.ports(), spaceId);
      try {
        const { ops: spaceOps, services } = ops();
        const destination = await pickDestination(services);
        if (destination === undefined) { return; }
        const outcome = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Downloading papers of "${name}"…` },
          () => spaceOps.download({ spaceId, what, destination }),
        );
        await services.reindexLibrary();
        void vscode.window.showInformationMessage(`Downloaded from "${name}": ${describeDownload(outcome)}`);
      } catch (error) {
        reportFailure(logger(), `download the papers of the Space "${name}"`, error, { spaceId, what: what.kind });
      }
    },
  };
}
