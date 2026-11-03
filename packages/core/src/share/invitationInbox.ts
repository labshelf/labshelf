// The inbox of invitations sealed to this library: reading it at most once a minute, opening and naming each invitation from local pins
// and contacts, and accepting or declining one.
import {
  deleteInvite, fingerprint, listInbox, openInvite, type Contact, type InboxInvite, type SealedEnvelope, type SealedInvitePayload,
} from "../collab/index.js";
import { learnContacts, publishCard } from "./invitationCards.js";
import type { EmailPin, InvitationContext, Ready } from "./invitations.js";
import type { InvitationView } from "./libraryShareHost.js";
import { checkInvite, joinInvite, type JoinOutcome } from "./projectShareFlows.js";
import { LOG_MODULE } from "./sharedProjects.js";

export const OFF = "Invitations by email are off; copy the invite link instead";
const GONE = "This invitation is not in your inbox.";
const READ_INTERVAL_MS = 60_000;

/** The email a local pin or contact gives this key pair, if any; the sender's own claim is never used. */
type EmailFor = (fingerprint: string, keys: { encryptionKey: string; signingKey: string }) => string | undefined;

export const sameKeys = (a: { encryptionKey: string; signingKey: string }, b: { encryptionKey: string; signingKey: string }): boolean =>
  a.encryptionKey === b.encryptionKey && a.signingKey === b.signingKey;

export function emailLookup(pins: readonly EmailPin[], contacts: readonly Contact[]): EmailFor {
  return (print, keys) => pins.find((pin) => pin.fingerprint === print && sameKeys(pin, keys))?.email
    ?? contacts.find((contact) => contact.fingerprint === print && sameKeys(contact, keys))?.email;
}

const optionalString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

async function toView(id: string, payload: SealedInvitePayload, emailFor: EmailFor): Promise<InvitationView> {
  const { sender } = payload;
  const name = optionalString(sender["name"]);
  const print = await fingerprint(sender.encryptionKey, sender.signingKey);
  const email = emailFor(print, sender);
  return {
    id, title: payload.title, created: payload.created, expires: payload.expires,
    from: { ...(name === undefined ? {} : { name }), ...(email === undefined ? {} : { email }), fingerprint: print },
  };
}

interface Held { view: InvitationView; sealed: SealedEnvelope }

interface InboxState {
  context: InvitationContext;
  listeners: Set<(invitations: InvitationView[]) => void>;
  held: Held[];
  readAt: number | undefined;
  reading: Promise<InvitationView[]> | undefined;
}

export interface InboxFlow {
  refreshInvitations: () => Promise<InvitationView[]>;
  onInvitationsChange: (listener: (invitations: InvitationView[]) => void) => () => void;
  acceptInvitation: (id: string, signal: AbortSignal) => Promise<JoinOutcome>;
  declineInvitation: (id: string) => Promise<void>;
  /** Empties the list, telling the listeners when it held any. */
  clear: () => void;
  /** The next refresh reads the inbox again. */
  invalidate: () => void;
}

const views = (inbox: InboxState): InvitationView[] => inbox.held.map((entry) => entry.view);

function setHeld(inbox: InboxState, next: Held[]): void {
  const changed = next.length !== inbox.held.length || next.some((entry, i) => entry.view.id !== inbox.held[i]?.view.id);
  inbox.held = next;
  if (!changed) { return; }
  const list = views(inbox);
  for (const listener of [...inbox.listeners]) { listener(list); }
}

async function open(context: InvitationContext, state: Ready, sealed: SealedEnvelope): Promise<SealedInvitePayload> {
  return openInvite(state.identity, sealed, { checkLink: checkInvite, now: context.now() });
}

async function drop(context: InvitationContext, state: Ready, id: string): Promise<void> {
  await deleteInvite({ relayUrl: state.account.relayUrl, ownerSecret: state.account.ownerSecret, id, fetch: context.doFetch });
}

/** Keeps the invitations already held, opens the new ones and deletes those that do not open. */
async function openAll(inbox: InboxState, state: Ready, invites: InboxInvite[], emailFor: EmailFor): Promise<Held[]> {
  const { context } = inbox;
  const next: Held[] = [];
  for (const invite of invites) {
    const known = inbox.held.find((entry) => entry.view.id === invite.id);
    if (known) { next.push(known); continue; }
    try {
      next.push({ view: await toView(invite.id, await open(context, state, invite.sealed), emailFor), sealed: invite.sealed });
    } catch (error) {
      void context.ports.logger.log("WARN", LOG_MODULE, "Dropped an invitation that does not open", { id: invite.id, error: String(error) });
      await drop(context, state, invite.id)
        .catch((failure: unknown) => context.ports.logger.error(LOG_MODULE, failure, { action: "delete an invitation", id: invite.id }));
    }
  }
  return next;
}

async function read(inbox: InboxState): Promise<InvitationView[]> {
  const { context } = inbox;
  const state = await context.ready();
  if (!state) { setHeld(inbox, []); return []; }
  await learnContacts(context.ports, state);
  const invites = await listInbox({ relayUrl: state.account.relayUrl, ownerSecret: state.account.ownerSecret, fetch: context.doFetch });
  const emailFor = emailLookup(await context.pins.read(state.invitationPorts), await state.invitationPorts.contacts.read());
  const next = await openAll(inbox, state, invites, emailFor);
  inbox.readAt = context.now();
  setHeld(inbox, next);
  return views(inbox);
}

async function refresh(inbox: InboxState): Promise<InvitationView[]> {
  const { context } = inbox;
  if (inbox.readAt !== undefined && context.now() - inbox.readAt < READ_INTERVAL_MS) { return views(inbox); }
  inbox.reading ??= read(inbox).catch((error: unknown) => {
    void context.ports.logger.error(LOG_MODULE, error, { action: "read the inbox" });
    // A failing inbox is retried at most once a minute, like a successful read.
    inbox.readAt = context.now();
    return views(inbox);
  }).finally(() => { inbox.reading = undefined; });
  return inbox.reading;
}

async function forget(inbox: InboxState, state: Ready, id: string): Promise<void> {
  await drop(inbox.context, state, id);
  setHeld(inbox, inbox.held.filter((entry) => entry.view.id !== id));
}

async function accept(inbox: InboxState, id: string, signal: AbortSignal): Promise<JoinOutcome> {
  const { context } = inbox;
  const { ports } = context;
  const state = await context.ready();
  const entry = inbox.held.find((candidate) => candidate.view.id === id);
  if (!state || !entry) { return { kind: "refused", problem: GONE }; }
  const checked = await open(context, state, entry.sealed)
    .then((opened) => checkInvite(opened.link))
    .catch((error: unknown) => ({ ok: false as const, problem: error instanceof Error ? error.message : String(error) }));
  if (!checked.ok) {
    await forget(inbox, state, id);
    return { kind: "refused", problem: checked.problem };
  }
  const outcome = await joinInvite(ports, checked.invite, signal);
  if (outcome.kind !== "refused") {
    await forget(inbox, state, id).catch((error: unknown) => ports.logger.error(LOG_MODULE, error, { action: "delete an accepted invitation", id }));
    const connection = ports.shares.active(checked.invite.shareId);
    if (connection) { await publishCard(context, connection).catch((error: unknown) => ports.logger.error(LOG_MODULE, error, { action: "publish the card" })); }
  }
  return outcome;
}

export function createInbox(context: InvitationContext): InboxFlow {
  const inbox: InboxState = { context, listeners: new Set(), held: [], readAt: undefined, reading: undefined };
  return {
    refreshInvitations: () => refresh(inbox),
    onInvitationsChange: (listener) => { inbox.listeners.add(listener); return () => { inbox.listeners.delete(listener); }; },
    acceptInvitation: (id, signal) => accept(inbox, id, signal),
    declineInvitation: async (id) => {
      const state = await context.ready();
      if (!state) { throw new Error(OFF); }
      await forget(inbox, state, id);
    },
    clear: () => { setHeld(inbox, []); },
    invalidate: () => { inbox.readAt = undefined; },
  };
}
