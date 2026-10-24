// Joins a shared project from pasted invite text, or reconnects a project of that share this device already has.
import { checkInvite } from "./inviteProblems.js";
import { LOG_MODULE, type ShareWorkflowPorts } from "./sharePorts.js";

export type JoinOutcome =
  /** The invite cannot be joined; `problem` says why in words for the user. Nothing was created. */
  | { kind: "refused"; problem: string }
  /** `active`: connected already, nothing changed; `resumed`: a project of the share reconnected; `joined`: a project was created. */
  | { kind: "active" | "resumed" | "joined"; folder: string };

/** `signal` cancels a join that waits for a member to answer. */
export async function joinSharedProject(ports: ShareWorkflowPorts, inviteText: string, signal: AbortSignal): Promise<JoinOutcome> {
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
