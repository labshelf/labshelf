// Reads pasted invite text and names, in words a user acts on, why it cannot be joined.
import { InviteWithoutRelayError, parseInvite, type Invite, type InviteError } from "../../invite/index.js";

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
