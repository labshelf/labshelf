// Asks for an invite link and a display name, joins the shared project through the core workflow and opens it in the page's project session.
import { joinSharedProject, UnknownShareKindError, type ILogger } from "@labshelf/core";
import { inputBox, toast } from "@labshelf/core/dom";
import type { ProjectSession } from "../../../session";
import type { PageSharing } from "../pageSharing";
import { loadDisplayName } from "../shareKeyStore";

const LOG_MODULE = "collab.joinDialog";

export interface JoinDialogOptions {
  sharing: Pick<PageSharing, "ports" | "shares" | "ready" | "closing">;
  logger: ILogger;
  session: Pick<ProjectSession, "openProject">;
  /** The invite a link carried; the dialog does not ask for it. */
  invite?: string;
}

const required = (what: string) => (value: string): string | null => (value.trim() === "" ? `Enter ${what}.` : null);

const failureMessage = (error: unknown): string =>
  error instanceof UnknownShareKindError
    ? "This invite is for something LabShelf cannot open yet."
    : `Could not join the shared project: ${error instanceof Error ? error.message : String(error)}`;

export async function runJoinDialog({ sharing, logger, session, invite }: JoinDialogOptions): Promise<void> {
  const inviteText = invite ?? await inputBox({
    title: "Join shared project", prompt: "Paste the invite link you received.", placeholder: "Invite link", validate: required("an invite link"),
  });
  if (inviteText === undefined) { return; }
  const name = await inputBox({
    title: "Your name", prompt: "Collaborators see it next to your cursor and comments.",
    value: (await loadDisplayName()) ?? sharing.shares.name(), validate: required("a name"),
  });
  if (name === undefined) { return; }
  const waiting = toast("Joining the shared project: waiting for a collaborator to answer.");
  try {
    await sharing.shares.setName(name);
    // The workflow finds a project of the share this library holds only in a project list that was read.
    await sharing.ready();
    const outcome = await joinSharedProject(sharing.ports, inviteText, sharing.closing);
    if (outcome.kind === "refused") { toast(outcome.problem, "error"); return; }
    if (outcome.kind === "active") { toast("This shared project is already connected on this device."); }
    const entry = sharing.ports.projects.list().find((candidate) => candidate.folder === outcome.folder);
    if (entry) { await session.openProject(entry); }
  } catch (error) {
    await logger.error(LOG_MODULE, error, { action: "join shared project" });
    toast(failureMessage(error), "error");
  } finally {
    waiting();
  }
}
