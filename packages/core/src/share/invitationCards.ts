// The signed card this library publishes in its shares and the directory registration behind the invitations switch: publishing and
// removing the card, learning the members' cards as contacts, turning invitations on and off, and moving both after a relay rotation.
import type { Doc } from "yjs";
import { addMemberContacts, inboxToken, publicKeys, readMembers, removeOwnCard, signCard, writeOwnCard } from "../collab/index.js";
import type { ShareConnection } from "../collab/session/index.js";
import { DirectoryError } from "./directoryClient.js";
import type { InvitationContext, Ready } from "./invitations.js";
import { LOG_MODULE, type ShareFlowPorts } from "./sharedProjects.js";

const NOT_AVAILABLE = "Invitations by email are not available yet";
const NO_RELAY = "Connect Cloudflare first";
const NO_INVITATIONS = "This app does not send invitations by email.";

/** What turning invitations off and moving relays do to the inbox. */
export interface InboxReset { clear: () => void; invalidate: () => void }

export interface CardFlow {
  setInvitationsEnabled: (on: boolean) => Promise<void>;
  updateAfterRotation: (change: { previousUrl: string; relayUrl: string }) => Promise<void>;
}

/** Runs `run` on every open share; a share that fails is logged and skipped. */
async function forEachShare(ports: ShareFlowPorts, action: string, run: (connection: ShareConnection) => Promise<void>): Promise<void> {
  for (const connection of ports.shares.list()) {
    await run(connection).catch((error: unknown) => ports.logger.error(LOG_MODULE, error, { action, shareId: connection.shareId }));
  }
}

/** Learns the cards in the index of one share; contacts already known keep their record. */
async function learnFrom(state: Ready, connection: ShareConnection): Promise<void> {
  const members = (await readMembers(connection.session.index)).filter((member) => member.fingerprint !== state.own);
  await addMemberContacts(state.invitationPorts.contacts, members);
}

/** Members who joined a share later are found from the shares' indexes; a share that fails is logged and skipped. */
export async function learnContacts(ports: ShareFlowPorts, state: Ready, except?: ShareConnection): Promise<void> {
  await forEachShare(ports, "learn contacts", async (connection) => { if (connection !== except) { await learnFrom(state, connection); } });
}

async function register(context: InvitationContext, state: Ready, relayUrl: string): Promise<void> {
  const keys = await publicKeys(state.identity);
  await context.directory!.register({ inboxUrl: relayUrl, inboxToken: await inboxToken(state.account.ownerSecret, state.own), ...keys });
}

async function writeCard(context: InvitationContext, state: Ready, index: Doc, relayUrl: string): Promise<void> {
  const card = await signCard(state.identity, {
    name: context.ports.userName(), inboxUrl: relayUrl, inboxToken: await inboxToken(state.account.ownerSecret, state.own),
  }, context.now());
  await writeOwnCard(index, state.identity, card);
}

/** Writes the own card into the share and learns its members' cards; does nothing while invitations are off. */
export async function publishCard(context: InvitationContext, connection: ShareConnection): Promise<void> {
  const state = await context.ready();
  if (!state) { return; }
  await writeCard(context, state, connection.session.index, state.account.relayUrl);
  await learnFrom(state, connection);
  await learnContacts(context.ports, state, connection);
}

async function disable(context: InvitationContext, state: Ready, inbox: InboxReset): Promise<void> {
  // The switch goes off and the cards go even when the directory cannot be reached, so nothing new arrives through the shares.
  const unregistered = context.directory!.unregister().then(() => undefined, (error: unknown) => error);
  await state.invitationPorts.enabled.set(false);
  await forEachShare(context.ports, "remove the card", (connection) => removeOwnCard(connection.session.index, state.identity));
  inbox.clear();
  const failure = await unregistered;
  if (failure !== undefined) { throw failure; }
}

async function enable(context: InvitationContext, state: Ready): Promise<void> {
  await state.invitationPorts.enabled.set(true);
  try {
    await register(context, state, state.account.relayUrl);
  } catch (error) {
    await state.invitationPorts.enabled.set(false);
    // TRAP: a Cloudflare token without User Details Read is refused `unauthorized`; the user cannot fix that here.
    if (error instanceof DirectoryError && error.reason === "unauthorized") { throw new Error(NOT_AVAILABLE, { cause: error }); }
    throw error;
  }
  await forEachShare(context.ports, "publish the card", (connection) => publishCard(context, connection));
}

export function createCards(context: InvitationContext, inbox: InboxReset): CardFlow {
  return {
    setInvitationsEnabled: async (on) => {
      if (!context.invitationPorts) { throw new Error(NO_INVITATIONS); }
      const state = await context.ready(true);
      if (!state) { throw new Error(NO_RELAY); }
      await (on ? enable(context, state) : disable(context, state, inbox));
    },
    updateAfterRotation: async ({ relayUrl }) => {
      const state = await context.ready();
      if (!state) { return; }
      // The cards go first, so a failing registration never leaves the shares naming the old relay.
      await forEachShare(context.ports, "move the card", (connection) => writeCard(context, state, connection.session.index, relayUrl));
      await register(context, state, relayUrl).catch((error: unknown) => context.ports.logger.error(LOG_MODULE, error, { action: "register the new relay" }));
      inbox.invalidate();
    },
  };
}
