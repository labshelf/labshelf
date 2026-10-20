// Shares a project, or reconnects one shared before, through the core workflow and hands the owner its invite link.
import { shareProject, type ILogger, type OwnRelayOffer, type ProjectEntry, type ShareWorkflowPorts } from "@labshelf/core";
import { showDialog, toast } from "@labshelf/core/dom";

const LOG_MODULE = "collab.shareDialog";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export interface ShareDialogContext {
  ports: ShareWorkflowPorts;
  closing: AbortSignal;
  logger: ILogger;
  /** Asks for an invite, for a shared project whose key this device lacks. */
  join(): void;
}

export const projectName = (project: ReadyProject): string => project.settings.title ?? project.settings.id;

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function reportRefusedOffer(offer: OwnRelayOffer): void {
  if (offer.kind !== "refused") { return; }
  toast(`Your relay did not take this project: ${errorText(offer.error)}. Collaborators reach it through the relays it lists.`, "error");
}

async function copied(logger: ILogger, link: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(link);
    return true;
  } catch (error) {
    // PLATFORM: the clipboard refuses a write once the page lost focus while the share connected; the dialog's button copies instead.
    await logger.log("WARN", LOG_MODULE, "Could not copy the invite link", { error: String(error) });
    return false;
  }
}

/** Shows the link, copied already when the clipboard allowed it, otherwise by the Copy Link button. */
async function offerInvite(logger: ILogger, name: string, link: string): Promise<void> {
  const wasCopied = await copied(logger, link);
  const choice = await showDialog({
    title: wasCopied ? `Copied the invite link to "${name}"` : `The invite link to "${name}" is ready`,
    message: `Anyone with it can read and edit the project, so send it only to collaborators: ${link}`,
    severity: "info",
    buttons: [...(wasCopied ? [] : [{ id: "copy" as const, label: "Copy Link", primary: true }]), { id: "close" as const, label: "Close", primary: wasCopied }],
  });
  if (choice !== "copy") { return; }
  if (await copied(logger, link)) { toast(`Copied the invite link to "${name}".`, "ok"); } else { toast("The browser refused the copy. Select the link in the dialog and copy it.", "error"); }
}

/** Runs for Share Project on an unshared project and for Copy Invite Link on a shared one, which reconnects it from its stored key. */
export async function runShareDialog(context: ShareDialogContext, project: ReadyProject): Promise<void> {
  const { ports, closing, logger } = context;
  const name = projectName(project);
  const { folder, settings: { shared } } = project;
  try {
    const outcome = await shareProject(ports, { folder, shared, signal: closing });
    if (outcome.kind === "noKey") {
      const choice = await showDialog({
        title: `"${name}" is shared, but its invite is not on this device`, message: "Paste the invite to reconnect it.", severity: "warning",
        buttons: [{ id: "join" as const, label: "Join Shared Project…", primary: true }, { id: "cancel" as const, label: "Cancel" }],
      });
      if (choice === "join") { context.join(); }
      return;
    }
    if (outcome.kind === "noRelay") {
      toast("Sharing needs a Cloudflare relay: every edit travels through it, end-to-end encrypted. Connect Cloudflare to share.");
      return;
    }
    reportRefusedOffer(outcome.offer);
    await offerInvite(logger, name, outcome.invite);
  } catch (error) {
    await logger.error(LOG_MODULE, error, { action: "share a project", folder, shareId: shared });
    toast(`Could not share "${name}": ${errorText(error)}`, "error");
  }
}
