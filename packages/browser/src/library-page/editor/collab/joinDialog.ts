// Asks for an invite link and a display name, joins the shared project and opens it in the page's project session.
import type { ILogger, LibraryFileSystem } from "@labshelf/core";
import { inputBox, toast } from "@labshelf/core/dom";
import { findProject } from "../../projects-data/findProject";
import type { ProjectSession } from "../../session";
import { UnknownShareKindError } from "./joinSharedProject";
import type { PageShares } from "./pageShares";
import { loadDisplayName } from "./shareKeyStore";

const LOG_MODULE = "collab.joinDialog";

export interface JoinDialogOptions {
  shares: Pick<PageShares, "join" | "setName" | "name">;
  fs: LibraryFileSystem;
  logger: ILogger;
  session: Pick<ProjectSession, "current" | "openProject">;
  /** The invite a link carried; the dialog does not ask for it. */
  invite?: string;
}

const required = (what: string) => (value: string): string | null => (value.trim() === "" ? `Enter ${what}.` : null);

const failureMessage = (error: unknown): string =>
  error instanceof UnknownShareKindError
    ? "This invite is for something LabShelf cannot open yet."
    : `Could not join the shared project: ${error instanceof Error ? error.message : String(error)}`;

export async function runJoinDialog({ shares, fs, logger, session, invite }: JoinDialogOptions): Promise<void> {
  const inviteText = invite ?? await inputBox({
    title: "Join shared project", prompt: "Paste the invite link you received.", placeholder: "Invite link", validate: required("an invite link"),
  });
  if (inviteText === undefined) { return; }
  const name = await inputBox({
    title: "Your name", prompt: "Collaborators see it next to your cursor and comments.",
    value: (await loadDisplayName()) ?? shares.name(), validate: required("a name"),
  });
  if (name === undefined) { return; }
  try {
    await shares.setName(name);
    const { projectId } = await shares.join(inviteText);
    await session.openProject(await findProject(fs, logger, session.current(), projectId));
  } catch (error) {
    await logger.error(LOG_MODULE, error, { action: "join shared project" });
    toast(failureMessage(error), "error");
  }
}
