// Invitations by email for one library: the identity and directory registration behind the switch, sealing a project's invite to a
// contact or a directory user, the inbox of invitations sealed to us, and the signed card this library publishes in its shares.
import type { Doc } from "yjs";
import { isRecord } from "../guards/index.js";
import {
  exportIdentity, fingerprint, generateIdentity, importIdentity, openInvite, publicKeys, sealInvite,
  type Identity, type IdentityJwk, type SealedInvitePayload, type SenderCard,
} from "../collab/invite/index.js";
import {
  addMemberContacts, readMembers, removeOwnCard, signCard, writeOwnCard, type Contact, type ContactsStore,
} from "../collab/members.js";
import { deleteInvite, inboxToken, listInbox, postInvite, type InboxInvite, type SealedEnvelope } from "../collab/relays/relayInbox.js";
import type { ShareConnection } from "../collab/session/index.js";
import type { RelayAccount } from "../relay/index.js";
import { createDirectoryClient, DirectoryError, type DirectoryClient } from "./directoryClient.js";
import type { ContactView, InvitationView, InviteByEmailResult } from "./libraryShareHost.js";
import { checkInvite, joinInvite, type JoinOutcome } from "./projectShareFlows.js";
import { LOG_MODULE, type ShareFlowPorts } from "./sharedProjects.js";

/** A recipient's email bound to the keys the directory first named for it; device-local, so a later answer with other keys cannot take over. */
export interface EmailPin { email: string; fingerprint: string; encryptionKey: string; signingKey: string; pinned: number }

/** What an app implements for invitations by email; the stores are scoped to one library. */
export interface InvitationPorts {
  /** Device-local and secret: the library's identity with its private keys. */
  identity: { load(): Promise<IdentityJwk | undefined>; save(jwk: IdentityJwk): Promise<void> };
  contacts: ContactsStore;
  /** Pins of looked-up emails to keys; absent, the pins last as long as the Invitations instance. */
  emailPins?: { read(): Promise<EmailPin[]>; write(pins: EmailPin[]): Promise<void> };
  /** The user's switch for invitations by email. */
  enabled: { get(): Promise<boolean>; set(on: boolean): Promise<void> };
  /** The Cloudflare access token the directory names the user by. */
  accessToken(): Promise<string>;
  now?(): number;
}

export interface InviteByEmailRequest { link: string; title: string; email: string }

export interface Invitations {
  /** The current list, read through `refreshInvitations`. */
  invitations(): Promise<InvitationView[]>;
  /** Reads the inbox at most once a minute; the apps call it at start and when All Projects opens. */
  refreshInvitations(): Promise<InvitationView[]>;
  onInvitationsChange(listener: (invitations: InvitationView[]) => void): () => void;
  /** Joins the invitation's share and deletes it from the inbox once joined; an invitation that fails to open is deleted and refused. */
  acceptInvitation(id: string, signal: AbortSignal): Promise<JoinOutcome>;
  declineInvitation(id: string): Promise<void>;
  inviteByEmail(request: InviteByEmailRequest): Promise<InviteByEmailResult>;
  /** The contacts as the UI may see them: no inbox address, inbox token or keys. */
  contacts(): Promise<ContactView[]>;
  invitationsEnabled(): Promise<boolean>;
  setInvitationsEnabled(on: boolean): Promise<void>;
  /** Writes the own card into the share and learns its members' cards; does nothing while invitations are off. Apps call it on resume. */
  publishCard(connection: ShareConnection): Promise<void>;
  /** Plugs into RotateRelayDeps.updateRegistration: moves the registration and the cards to the new relay. */
  updateAfterRotation(change: { previousUrl: string; relayUrl: string }): Promise<void>;
}

export const INVITATION_NOT_FOUND = "No LabShelf invitations for this email; copy the invite link instead";
const NOT_AVAILABLE = "Invitations by email are not available yet";
const NO_RELAY = "Connect Cloudflare first";
const NO_INVITATIONS = "This app does not send invitations by email.";
const OFF = "Invitations by email are off; copy the invite link instead";
const GONE = "This invitation is not in your inbox.";
const READ_INTERVAL_MS = 60_000;

interface Held { view: InvitationView; sealed: SealedEnvelope }

interface Ready { invitationPorts: InvitationPorts; account: RelayAccount; identity: Identity; own: string }

const isKeyPair = (value: unknown): boolean => isRecord(value) && isRecord(value["privateKey"]) && isRecord(value["publicKey"]);

/** Shape check for a stored identity; the apps use it so a malformed record reads as absent. */
export function isIdentityJwk(value: unknown): value is IdentityJwk {
  return isRecord(value) && isKeyPair(value["encryption"]) && isKeyPair(value["signing"]);
}

const CONTACT_STRINGS = ["name", "inboxUrl", "inboxToken", "encryptionKey", "signingKey", "fingerprint"] as const;

/** Shape check for a stored contact. */
export function isContact(value: unknown): value is Contact {
  return isRecord(value) && CONTACT_STRINGS.every((field) => typeof value[field] === "string") && typeof value["updated"] === "number"
    && (value["email"] === undefined || typeof value["email"] === "string");
}

const PIN_STRINGS = ["email", "fingerprint", "encryptionKey", "signingKey"] as const;

/** Shape check for a stored email pin. */
export function isEmailPin(value: unknown): value is EmailPin {
  return isRecord(value) && PIN_STRINGS.every((field) => typeof value[field] === "string") && typeof value["pinned"] === "number";
}

const optionalString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** The email a local pin or contact gives this key pair, if any; the sender's own claim is never used. */
type EmailFor = (fingerprint: string, keys: { encryptionKey: string; signingKey: string }) => string | undefined;

const sameKeys = (a: { encryptionKey: string; signingKey: string }, b: { encryptionKey: string; signingKey: string }): boolean =>
  a.encryptionKey === b.encryptionKey && a.signingKey === b.signingKey;

function emailLookup(pins: readonly EmailPin[], contacts: readonly Contact[]): EmailFor {
  return (print, keys) => pins.find((pin) => pin.fingerprint === print && sameKeys(pin, keys))?.email
    ?? contacts.find((contact) => contact.fingerprint === print && sameKeys(contact, keys))?.email;
}

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

function fallback(link: string, message: string): InviteByEmailResult {
  return { fallback: "link", link, message };
}

/** Without the invitations port or a relay account every op behaves as off. */
export function createInvitations(ports: ShareFlowPorts, options: { directory?: DirectoryClient } = {}): Invitations {
  const invitationPorts = ports.invitations;
  const doFetch = ports.fetch ?? fetch;
  const directory = options.directory ?? (invitationPorts ? createDirectoryClient({ accessToken: () => invitationPorts.accessToken(), fetch: doFetch }) : undefined);
  const listeners = new Set<(invitations: InvitationView[]) => void>();
  let held: Held[] = [];
  let readAt: number | undefined;
  let reading: Promise<InvitationView[]> | undefined;
  let creating: Promise<Identity> | undefined;
  let memoryPins: EmailPin[] = [];

  const now = () => invitationPorts?.now?.() ?? Date.now();
  const views = () => held.map((entry) => entry.view);

  function setHeld(next: Held[]): void {
    const changed = next.length !== held.length || next.some((entry, i) => entry.view.id !== held[i]?.view.id);
    held = next;
    if (!changed) { return; }
    const list = views();
    for (const listener of [...listeners]) { listener(list); }
  }

  const readPins = async (store: InvitationPorts): Promise<EmailPin[]> => (store.emailPins ? store.emailPins.read() : memoryPins);
  const writePins = async (store: InvitationPorts, pins: EmailPin[]): Promise<void> => {
    if (store.emailPins) { await store.emailPins.write(pins); } else { memoryPins = pins; }
  };

  /** Loads the library's identity, creating and saving one on first use. */
  async function loadIdentity(store: InvitationPorts): Promise<Identity> {
    const stored = await store.identity.load();
    if (stored) { return importIdentity(stored); }
    creating ??= (async () => {
      const identity = await generateIdentity();
      await store.identity.save(await exportIdentity(identity));
      return identity;
    })().finally(() => { creating = undefined; });
    return creating;
  }

  /** Undefined while invitations are off: no port, no relay account, or the switch off (unless `anyway`). */
  async function ready(anyway = false): Promise<Ready | undefined> {
    if (!invitationPorts) { return undefined; }
    const account = await ports.relay.get();
    if (!account || (!anyway && !(await invitationPorts.enabled.get()))) { return undefined; }
    const identity = await loadIdentity(invitationPorts);
    const keys = await publicKeys(identity);
    return { invitationPorts, account, identity, own: await fingerprint(keys.encryptionKey, keys.signingKey) };
  }

  async function register(state: Ready, relayUrl: string): Promise<void> {
    const keys = await publicKeys(state.identity);
    await directory!.register({ inboxUrl: relayUrl, inboxToken: await inboxToken(state.account.ownerSecret, state.own), ...keys });
  }

  async function writeCard(state: Ready, index: Doc, relayUrl: string): Promise<void> {
    const card = await signCard(state.identity, {
      name: ports.userName(), inboxUrl: relayUrl, inboxToken: await inboxToken(state.account.ownerSecret, state.own),
    }, now());
    await writeOwnCard(index, state.identity, card);
  }

  async function forEachShare(action: string, run: (connection: ShareConnection) => Promise<void>): Promise<void> {
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
  async function learnContacts(state: Ready, except?: ShareConnection): Promise<void> {
    await forEachShare("learn contacts", async (connection) => { if (connection !== except) { await learnFrom(state, connection); } });
  }

  async function open(state: Ready, invite: InboxInvite): Promise<SealedInvitePayload> {
    return openInvite(state.identity, invite.sealed, { checkLink: checkInvite, now: now() });
  }

  async function drop(state: Ready, id: string): Promise<void> {
    await deleteInvite({ relayUrl: state.account.relayUrl, ownerSecret: state.account.ownerSecret, id, fetch: doFetch });
  }

  async function read(): Promise<InvitationView[]> {
    const state = await ready();
    if (!state) { setHeld([]); return []; }
    await learnContacts(state);
    const inbox = await listInbox({ relayUrl: state.account.relayUrl, ownerSecret: state.account.ownerSecret, fetch: doFetch });
    const emailFor = emailLookup(await readPins(state.invitationPorts), await state.invitationPorts.contacts.read());
    const next: Held[] = [];
    for (const invite of inbox) {
      const known = held.find((entry) => entry.view.id === invite.id);
      if (known) { next.push(known); continue; }
      try {
        next.push({ view: await toView(invite.id, await open(state, invite), emailFor), sealed: invite.sealed });
      } catch (error) {
        void ports.logger.log("WARN", LOG_MODULE, "Dropped an invitation that does not open", { id: invite.id, error: String(error) });
        await drop(state, invite.id).catch((failure: unknown) => ports.logger.error(LOG_MODULE, failure, { action: "delete an invitation", id: invite.id }));
      }
    }
    readAt = now();
    setHeld(next);
    return views();
  }

  async function refreshInvitations(): Promise<InvitationView[]> {
    if (readAt !== undefined && now() - readAt < READ_INTERVAL_MS) { return views(); }
    reading ??= read().catch((error: unknown) => {
      void ports.logger.error(LOG_MODULE, error, { action: "read the inbox" });
      // A failing inbox is retried at most once a minute, like a successful read.
      readAt = now();
      return views();
    }).finally(() => { reading = undefined; });
    return reading;
  }

  async function forget(state: Ready, id: string): Promise<void> {
    await drop(state, id);
    setHeld(held.filter((entry) => entry.view.id !== id));
  }

  async function publishCard(connection: ShareConnection): Promise<void> {
    const state = await ready();
    if (!state) { return; }
    const index = connection.session.index;
    await writeCard(state, index, state.account.relayUrl);
    await learnFrom(state, connection);
    await learnContacts(state, connection);
  }

  async function seal(state: Ready, request: InviteByEmailRequest, recipient: { encryptionKey: string; fingerprint: string }): Promise<SealedEnvelope> {
    const card: SenderCard = { name: ports.userName(), ...(await publicKeys(state.identity)) };
    const sealed = await sealInvite({ sender: state.identity, card, recipient, link: request.link, title: request.title, now: now() });
    return { ...sealed };
  }

  /** The first pin per email wins; a lookup with other keys is still sent through the directory but does not replace it. */
  async function pinEmail(store: InvitationPorts, email: string, keys: { fingerprint: string; encryptionKey: string; signingKey: string }): Promise<void> {
    const pins = await readPins(store);
    const pinned = pins.find((pin) => pin.email === email);
    if (!pinned) {
      await writePins(store, [...pins, { email, fingerprint: keys.fingerprint, encryptionKey: keys.encryptionKey, signingKey: keys.signingKey, pinned: now() }]);
    } else if (pinned.fingerprint !== keys.fingerprint || !sameKeys(pinned, keys)) {
      void ports.logger.log("WARN", LOG_MODULE, "The directory named other keys for a pinned email; keeping the first pin", { fingerprint: keys.fingerprint });
    }
  }

  async function send(state: Ready, request: InviteByEmailRequest): Promise<InviteByEmailResult> {
    const email = request.email.trim().toLowerCase();
    await learnContacts(state);
    const contacts = await state.invitationPorts.contacts.read();
    const pin = (await readPins(state.invitationPorts)).find((candidate) => candidate.email === email);
    const contact = (pin && contacts.find((candidate) => candidate.fingerprint === pin.fingerprint && sameKeys(candidate, pin)))
      ?? contacts.find((candidate) => candidate.email?.toLowerCase() === email);
    if (contact) {
      const sealed = await seal(state, request, contact);
      await postInvite({ inboxUrl: contact.inboxUrl, inboxToken: contact.inboxToken, sealed, from: state.own, fetch: doFetch });
      return { sent: "direct" };
    }
    const recipient = await directory!.lookup(email);
    if (!recipient) { return fallback(request.link, INVITATION_NOT_FOUND); }
    await pinEmail(state.invitationPorts, email, recipient);
    await directory!.send(email, await seal(state, request, recipient));
    return { sent: "directory" };
  }

  return {
    invitations: refreshInvitations,
    refreshInvitations,
    onInvitationsChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async acceptInvitation(id, signal) {
      const state = await ready();
      const entry = held.find((candidate) => candidate.view.id === id);
      if (!state || !entry) { return { kind: "refused", problem: GONE }; }
      const checked = await open(state, { id, sealed: entry.sealed, from: "", received: 0 })
        .then((opened) => checkInvite(opened.link))
        .catch((error: unknown) => ({ ok: false as const, problem: error instanceof Error ? error.message : String(error) }));
      if (!checked.ok) {
        await forget(state, id);
        return { kind: "refused", problem: checked.problem };
      }
      const outcome = await joinInvite(ports, checked.invite, signal);
      if (outcome.kind !== "refused") {
        await forget(state, id).catch((error: unknown) => ports.logger.error(LOG_MODULE, error, { action: "delete an accepted invitation", id }));
        const connection = ports.shares.active(checked.invite.shareId);
        if (connection) { await publishCard(connection).catch((error: unknown) => ports.logger.error(LOG_MODULE, error, { action: "publish the card" })); }
      }
      return outcome;
    },
    async declineInvitation(id) {
      const state = await ready();
      if (!state) { throw new Error(OFF); }
      await forget(state, id);
    },
    async inviteByEmail(request) {
      const state = await ready();
      if (!state) { return fallback(request.link, OFF); }
      try {
        return await send(state, request);
      } catch (error) {
        void ports.logger.error(LOG_MODULE, error, { action: "send an invitation by email" });
        if (error instanceof DirectoryError && error.reason === "not_found") { return fallback(request.link, INVITATION_NOT_FOUND); }
        const reason = error instanceof Error ? error.message : String(error);
        return fallback(request.link, `LabShelf could not send the invitation (${reason}); copy the invite link instead`);
      }
    },
    async contacts() {
      const state = await ready();
      if (!state) { return []; }
      const emailFor = emailLookup(await readPins(state.invitationPorts), []);
      return (await state.invitationPorts.contacts.read()).map((contact) => {
        const email = contact.email ?? emailFor(contact.fingerprint, contact);
        return { name: contact.name, ...(email === undefined ? {} : { email }), fingerprint: contact.fingerprint };
      });
    },
    async invitationsEnabled() {
      return (await ready()) !== undefined;
    },
    async setInvitationsEnabled(on) {
      if (!invitationPorts) { throw new Error(NO_INVITATIONS); }
      const state = await ready(true);
      if (!state) { throw new Error(NO_RELAY); }
      if (!on) {
        // The switch goes off and the cards go even when the directory cannot be reached, so nothing new arrives through the shares.
        const unregistered = directory!.unregister().then(() => undefined, (error: unknown) => error);
        await invitationPorts.enabled.set(false);
        await forEachShare("remove the card", (connection) => removeOwnCard(connection.session.index, state.identity));
        setHeld([]);
        const failure = await unregistered;
        if (failure !== undefined) { throw failure; }
        return;
      }
      await invitationPorts.enabled.set(true);
      try {
        await register(state, state.account.relayUrl);
      } catch (error) {
        await invitationPorts.enabled.set(false);
        // TRAP: a Cloudflare token without User Details Read is refused `unauthorized`; the user cannot fix that here.
        if (error instanceof DirectoryError && error.reason === "unauthorized") { throw new Error(NOT_AVAILABLE, { cause: error }); }
        throw error;
      }
      await forEachShare("publish the card", publishCard);
    },
    publishCard,
    async updateAfterRotation({ relayUrl }) {
      const state = await ready();
      if (!state) { return; }
      // The cards go first, so a failing registration never leaves the shares naming the old relay.
      await forEachShare("move the card", (connection) => writeCard(state, connection.session.index, relayUrl));
      await register(state, relayUrl).catch((error: unknown) => ports.logger.error(LOG_MODULE, error, { action: "register the new relay" }));
      readAt = undefined;
    },
  };
}
