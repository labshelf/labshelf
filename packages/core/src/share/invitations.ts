// Invitations by email for one library: the identity and the context every flow shares, sealing a project's invite to a contact or a
// directory user, and the composition with the inbox (invitationInbox.ts) and the card and registration flows (invitationCards.ts).
import { isRecord } from "../guards/index.js";
import {
  exportIdentity, fingerprint, generateIdentity, importIdentity, postInvite, publicKeys, sealInvite,
  type Contact, type ContactsStore, type Identity, type IdentityJwk, type SealedEnvelope, type SenderCard,
} from "../collab/index.js";
import type { ShareConnection } from "../collab/session/index.js";
import type { RelayAccount } from "../relay/index.js";
import { createDirectoryClient, DirectoryError, type DirectoryClient } from "./directoryClient.js";
import { createCards, learnContacts, publishCard } from "./invitationCards.js";
import { createInbox, emailLookup, OFF, sameKeys } from "./invitationInbox.js";
import type { ContactView, InvitationView, InviteByEmailResult } from "./libraryShareHost.js";
import type { JoinOutcome } from "./projectShareFlows.js";
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

/** Invitations are on: the port, the relay account and the library's identity with its fingerprint. */
export interface Ready { invitationPorts: InvitationPorts; account: RelayAccount; identity: Identity; own: string }

/** What the invitation flows share: the ports, the directory, the clock, the readiness check and the email pins. */
export interface InvitationContext {
  ports: ShareFlowPorts;
  invitationPorts: InvitationPorts | undefined;
  doFetch: typeof fetch;
  directory: DirectoryClient | undefined;
  now(): number;
  /** Undefined while invitations are off: no port, no relay account, or the switch off (unless `anyway`). */
  ready(anyway?: boolean): Promise<Ready | undefined>;
  pins: { read(store: InvitationPorts): Promise<EmailPin[]>; write(store: InvitationPorts, pins: EmailPin[]): Promise<void> };
}

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

function fallback(link: string, message: string): InviteByEmailResult {
  return { fallback: "link", link, message };
}

/** Loads the library's identity, creating and saving one on first use; concurrent first uses share one creation. */
function identityLoader(): (store: InvitationPorts) => Promise<Identity> {
  let creating: Promise<Identity> | undefined;
  return async (store) => {
    const stored = await store.identity.load();
    if (stored) { return importIdentity(stored); }
    creating ??= (async () => {
      const identity = await generateIdentity();
      await store.identity.save(await exportIdentity(identity));
      return identity;
    })().finally(() => { creating = undefined; });
    return creating;
  };
}

/** The pins in the app's store, or in memory when the app keeps none. */
function pinStore(): InvitationContext["pins"] {
  let memoryPins: EmailPin[] = [];
  return {
    read: async (store) => (store.emailPins ? store.emailPins.read() : memoryPins),
    async write(store, pins) {
      if (store.emailPins) { await store.emailPins.write(pins); } else { memoryPins = pins; }
    },
  };
}

function createContext(ports: ShareFlowPorts, options: { directory?: DirectoryClient }): InvitationContext {
  const invitationPorts = ports.invitations;
  const doFetch = ports.fetch ?? fetch;
  const directory = options.directory ?? (invitationPorts ? createDirectoryClient({ accessToken: () => invitationPorts.accessToken(), fetch: doFetch }) : undefined);
  const now = () => invitationPorts?.now?.() ?? Date.now();
  const loadIdentity = identityLoader();
  async function ready(anyway = false): Promise<Ready | undefined> {
    if (!invitationPorts) { return undefined; }
    const account = await ports.relay.get();
    if (!account || (!anyway && !(await invitationPorts.enabled.get()))) { return undefined; }
    const identity = await loadIdentity(invitationPorts);
    const keys = await publicKeys(identity);
    return { invitationPorts, account, identity, own: await fingerprint(keys.encryptionKey, keys.signingKey) };
  }
  return { ports, invitationPorts, doFetch, directory, now, ready, pins: pinStore() };
}

async function seal(
  context: InvitationContext, state: Ready, request: InviteByEmailRequest, recipient: { encryptionKey: string; fingerprint: string },
): Promise<SealedEnvelope> {
  const card: SenderCard = { name: context.ports.userName(), ...(await publicKeys(state.identity)) };
  const sealed = await sealInvite({ sender: state.identity, card, recipient, link: request.link, title: request.title, now: context.now() });
  return { ...sealed };
}

/** The first pin per email wins; a lookup with other keys is still sent through the directory but does not replace it. */
async function pinEmail(
  context: InvitationContext, store: InvitationPorts, email: string, keys: { fingerprint: string; encryptionKey: string; signingKey: string },
): Promise<void> {
  const pins = await context.pins.read(store);
  const pinned = pins.find((pin) => pin.email === email);
  if (!pinned) {
    await context.pins.write(store, [...pins, { email, fingerprint: keys.fingerprint, encryptionKey: keys.encryptionKey, signingKey: keys.signingKey, pinned: context.now() }]);
  } else if (pinned.fingerprint !== keys.fingerprint || !sameKeys(pinned, keys)) {
    void context.ports.logger.log("WARN", LOG_MODULE, "The directory named other keys for a pinned email; keeping the first pin", { fingerprint: keys.fingerprint });
  }
}

/** The contact the email's pin names, else the contact whose card claims the email. */
async function findContact(context: InvitationContext, state: Ready, email: string): Promise<Contact | undefined> {
  const contacts = await state.invitationPorts.contacts.read();
  const pin = (await context.pins.read(state.invitationPorts)).find((candidate) => candidate.email === email);
  return (pin && contacts.find((candidate) => candidate.fingerprint === pin.fingerprint && sameKeys(candidate, pin)))
    ?? contacts.find((candidate) => candidate.email?.toLowerCase() === email);
}

async function send(context: InvitationContext, state: Ready, request: InviteByEmailRequest): Promise<InviteByEmailResult> {
  const email = request.email.trim().toLowerCase();
  await learnContacts(context.ports, state);
  const contact = await findContact(context, state, email);
  if (contact) {
    const sealed = await seal(context, state, request, contact);
    await postInvite({ inboxUrl: contact.inboxUrl, inboxToken: contact.inboxToken, sealed, from: state.own, fetch: context.doFetch });
    return { sent: "direct" };
  }
  const recipient = await context.directory!.lookup(email);
  if (!recipient) { return fallback(request.link, INVITATION_NOT_FOUND); }
  await pinEmail(context, state.invitationPorts, email, recipient);
  await context.directory!.send(email, await seal(context, state, request, recipient));
  return { sent: "directory" };
}

async function inviteByEmail(context: InvitationContext, request: InviteByEmailRequest): Promise<InviteByEmailResult> {
  const state = await context.ready();
  if (!state) { return fallback(request.link, OFF); }
  try {
    return await send(context, state, request);
  } catch (error) {
    void context.ports.logger.error(LOG_MODULE, error, { action: "send an invitation by email" });
    if (error instanceof DirectoryError && error.reason === "not_found") { return fallback(request.link, INVITATION_NOT_FOUND); }
    const reason = error instanceof Error ? error.message : String(error);
    return fallback(request.link, `LabShelf could not send the invitation (${reason}); copy the invite link instead`);
  }
}

async function contactViews(context: InvitationContext): Promise<ContactView[]> {
  const state = await context.ready();
  if (!state) { return []; }
  const emailFor = emailLookup(await context.pins.read(state.invitationPorts), []);
  return (await state.invitationPorts.contacts.read()).map((contact) => {
    const email = contact.email ?? emailFor(contact.fingerprint, contact);
    return { name: contact.name, ...(email === undefined ? {} : { email }), fingerprint: contact.fingerprint };
  });
}

/** Without the invitations port or a relay account every op behaves as off. */
export function createInvitations(ports: ShareFlowPorts, options: { directory?: DirectoryClient } = {}): Invitations {
  const context = createContext(ports, options);
  const inbox = createInbox(context);
  const cards = createCards(context, inbox);
  return {
    invitations: inbox.refreshInvitations,
    refreshInvitations: inbox.refreshInvitations,
    onInvitationsChange: inbox.onInvitationsChange,
    acceptInvitation: inbox.acceptInvitation,
    declineInvitation: inbox.declineInvitation,
    inviteByEmail: (request) => inviteByEmail(context, request),
    contacts: () => contactViews(context),
    invitationsEnabled: async () => (await context.ready()) !== undefined,
    setInvitationsEnabled: cards.setInvitationsEnabled,
    publishCard: (connection) => publishCard(context, connection),
    updateAfterRotation: cards.updateAfterRotation,
  };
}
