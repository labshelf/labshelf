// Answers the Space page's share actions in the browser: share with progress and the invite to copy, leave after a confirm, the share state, and downloading a shared Space's papers into a library folder.
// CONTRACT: documents/contracts/spaces.md#sharing
import {
  createListeners, createSpaceShareOps, formatError, PAPERS_DIR, ROOT_LABEL,
  type ILogger, type MutationContext, type PaperRecord, type SpacePapersDownload, type SpaceShareDeps, type SpacesHostPort,
} from "@labshelf/core";
import { openProgressDialog, pickQuickEntry, reportFailure, showDialog, showNoticeDialog, showToast } from "@labshelf/core/dom";

export type SpaceSharingPort = Required<Pick<SpacesHostPort, "shareSpace" | "leaveSpace" | "spaceShareState" | "onSpaceShareChange" | "downloadSpacePapers">>;

export interface SpaceSharingOptions {
  deps: SpaceShareDeps;
  /** Fires when a share or its connection changes and after every re-read of the Spaces. */
  onShareChange(listener: () => void): () => void;
  mutationContext(): MutationContext;
  /** The library folders under papers/, the root excluded. */
  libraryFolders(): Array<{ label: string; path: string }>;
  /** Caches the downloaded records and re-reads the library. */
  papersAdded(records: readonly PaperRecord[]): Promise<void>;
  copyText(text: string): Promise<boolean>;
  logger: ILogger;
}

const SHARE_NOTICE = "Anyone with the invite link can read and edit this Space, its notes, papers and projects, and pass the link on. There are no roles, so send it only to collaborators. Edits travel through your Cloudflare relay, end-to-end encrypted.";
const COPY_REFUSED_TEXT = "The clipboard refused the copy; select the link and copy it.";
const MODULE = "spaces.sharing";

function nameOf(deps: SpaceShareDeps, id: string): string {
  return deps.ports.spaces?.list().find((space) => space.id === id)?.name ?? "this Space";
}

async function showInvite(options: SpaceSharingOptions, name: string, invite: string): Promise<void> {
  for (;;) {
    const choice = await showDialog({
      title: `Invite link for "${name}"`,
      message: `${invite}\n\nAnyone with it can read and edit the Space.`,
      buttons: [{ id: "copy" as const, label: "Copy Invite Link", primary: true }],
    });
    if (choice !== "copy") { return; }
    const copied = await options.copyText(invite);
    showToast(copied ? `Copied the invite link for "${name}".` : COPY_REFUSED_TEXT, copied ? "ok" : "error");
    if (copied) { return; }
  }
}

async function share(options: SpaceSharingOptions, ops: ReturnType<typeof createSpaceShareOps>, id: string, changed: () => void): Promise<void> {
  const name = nameOf(options.deps, id);
  if (!ops.status(id).shared) {
    const choice = await showDialog({ title: `Share "${name}"?`, message: SHARE_NOTICE, buttons: [{ id: "share" as const, label: "Share", primary: true }] });
    if (choice !== "share") { return; }
  }
  const progress = openProgressDialog({ title: `Sharing "${name}"`, message: `Sharing "${name}"…`, cancellable: true });
  let result: Awaited<ReturnType<typeof ops.share>>;
  try {
    result = await ops.share(id, progress.signal);
  } catch (error) {
    if (progress.signal.aborted) { return; }
    throw error;
  } finally {
    progress.close();
    changed();
  }
  if (progress.signal.aborted) { return; }
  if (result.kind === "shared") { await showInvite(options, name, result.invite); return; }
  if (result.kind === "noRelay") {
    await showNoticeDialog("Connect Cloudflare to share", "Sharing needs a Cloudflare relay: every edit travels through it, end-to-end encrypted. Connect Cloudflare to share.");
    return;
  }
  await showNoticeDialog(`"${name}" is shared, but its invite is not on this device`, "Paste the invite with Join Shared Project to reconnect it.", "warning");
}

async function leave(options: SpaceSharingOptions, ops: ReturnType<typeof createSpaceShareOps>, id: string, changed: () => void): Promise<void> {
  const name = nameOf(options.deps, id);
  const choice = await showDialog({
    title: `Stop sharing "${name}" on this device?`,
    message: "The Space keeps every file here and the other members keep the share. Join it again from an invite to sync once more.",
    severity: "warning",
    buttons: [{ id: "leave" as const, label: "Stop Sharing", danger: true }],
  });
  if (choice !== "leave") { return; }
  try { await ops.leave(id); } finally { changed(); }
  showToast(`"${name}" is no longer shared on this device.`, "ok");
}

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

async function download(options: SpaceSharingOptions, ops: ReturnType<typeof createSpaceShareOps>, id: string, what: SpacePapersDownload): Promise<void> {
  const items = [{ label: ROOT_LABEL, path: PAPERS_DIR }, ...options.libraryFolders()]
    .map((folder) => ({ label: folder.label, icon: (folder.path === PAPERS_DIR ? "library" : "folder") as "library" | "folder", value: folder.path }));
  const destination = await pickQuickEntry(items, { title: "Download papers", placeholder: "Pick the library folder they go into" });
  if (destination === undefined) { return; }
  const outcome = await ops.download({ spaceId: id, what, destination });
  await options.papersAdded(outcome.added);
  void options.logger.log("INFO", MODULE, "Downloaded the papers of a shared Space", {
    spaceId: id, kind: what.kind, added: outcome.added.length, present: outcome.present.length, missingPdfs: outcome.missingPdfs.length,
  });
  const parts = [`Added ${count(outcome.added.length, "paper")}`];
  if (outcome.present.length > 0) { parts.push(`${count(outcome.present.length, "paper")} already in the library`); }
  if (outcome.missingPdfs.length > 0) { parts.push(`no peer sent the PDF of ${outcome.missingPdfs.join(", ")}`); }
  showToast(`${parts.join("; ")}.`, outcome.missingPdfs.length > 0 ? "info" : "ok");
}

/** The Space share actions of the page's Spaces host port. */
export function createSpaceSharingPort(options: SpaceSharingOptions): SpaceSharingPort {
  const ops = createSpaceShareOps(options.deps, options.mutationContext);
  const listeners = createListeners();
  const changed = (): void => listeners.emit();
  return {
    shareSpace: (id) => reportFailure("share the Space", () => share(options, ops, id, changed)),
    leaveSpace: (id) => reportFailure("stop sharing the Space", () => leave(options, ops, id, changed)),
    spaceShareState: (id) => ops.status(id),
    onSpaceShareChange: (listener) => {
      const stops = [listeners.add(listener), options.onShareChange(listener)];
      return () => stops.forEach((stop) => stop());
    },
    downloadSpacePapers: (id, what) => download(options, ops, id, what).catch(async (error: unknown) => {
      await options.logger.error(MODULE, error, { action: "download the papers of a shared Space", spaceId: id, kind: what.kind });
      showToast(`Could not download the papers: ${formatError(error)}`, "error");
    }),
  };
}
