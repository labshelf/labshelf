// Joins a shared project from a pasted invite under its tab lease, and stores the invite once the project exists in the library.
import { assertInviteHasRelay, parseInvite, type ILogger, type Invite, type RelayNetwork } from "@labshelf/core";
import { acquireTabLease, tabLeaseName } from "../../../storage";
import { connectBrowserShare, type ShareSources } from "./browserShareConnection";
import { ProjectShare, type ShareEntryOptions } from "./projectShareEntry";
import { saveShare } from "./shareKeyStore";

const LOG_MODULE = "collab.join";

export interface JoinProjectShareOptions {
  inviteText: string;
  libraryId: string;
  sources: ShareSources;
  name: string;
  logger: ILogger;
  network?: RelayNetwork | undefined;
  /** Aborting it cancels the join, as closing the page does. */
  signal: AbortSignal;
  /** The options of the joined project's entry. */
  entry(projectId: string, folder: string, invite: Invite): ShareEntryOptions;
}

export async function joinProjectShare(options: JoinProjectShareOptions): Promise<{ projectId: string; share: ProjectShare }> {
  const { inviteText, libraryId, sources, name, logger, network, signal } = options;
  const parsed = await parseInvite(inviteText);
  if (!parsed.ok) { throw new Error(`The text holds no valid invite: ${parsed.error}`); }
  const { invite } = parsed;
  assertInviteHasRelay(invite);
  const held = await acquireTabLease(tabLeaseName(libraryId, invite.shareId));
  if (held.kind === "busy") { throw new Error("This shared project is open in another tab"); }
  try {
    const connection = await connectBrowserShare({
      invite, libraryId, tab: held.lease, sources, name, logger, network, start: { mode: "join", signal },
    });
    await saveShare(libraryId, invite.shareId, invite.shareKey, invite.relays);
    const projectId = connection.joinedId ?? connection.folder;
    const share = new ProjectShare(options.entry(projectId, connection.folder, invite));
    share.adopt(held.lease, connection);
    await logger.log("INFO", LOG_MODULE, "Joined a shared project", { shareId: invite.shareId, folder: connection.folder });
    return { projectId, share };
  } catch (error) {
    await held.lease.release();
    throw error;
  }
}
