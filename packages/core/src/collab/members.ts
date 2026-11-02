// Signed contact cards in the index doc's members map, the local contacts store that pins their keys per email, and contact suggestions.
import { isRecord } from "../guards/index.js";
import { fingerprint, publicKeys, signObject, verifyObject, type Identity, type JsonObject } from "./invite/index.js";
import { readShareIndexDocMembers } from "./shareIndexDoc.js";
import type { Doc } from "yjs";

/** A contact card as written to the members map; unknown keys are kept, signed and passed on. */
export interface ContactCard {
  name: string;
  email?: string;
  inboxUrl: string;
  inboxToken: string;
  encryptionKey: string;
  signingKey: string;
  /** Epoch ms of the card's last write. */
  updated: number;
  sig: string;
  [key: string]: unknown;
}

/** The fields a user chooses; the keys, `updated` and `sig` are set by signing. */
export interface ContactCardFields {
  name: string;
  email?: string;
  inboxUrl: string;
  inboxToken: string;
  [key: string]: unknown;
}

export interface Member {
  fingerprint: string;
  card: ContactCard;
}

/** Signs the fields as the identity's own card. */
export async function signCard(identity: Identity, fields: ContactCardFields, now: number = Date.now()): Promise<ContactCard> {
  const { sig: _sig, ...rest } = fields;
  const unsigned = { ...rest, ...(await publicKeys(identity)), updated: now };
  return { ...unsigned, sig: await signObject(identity, unsigned as JsonObject) } as ContactCard;
}

/** Writes the card under the identity's fingerprint; throws when the card carries other keys. */
export async function writeOwnCard(doc: Doc, identity: Identity, card: ContactCard): Promise<void> {
  const keys = await publicKeys(identity);
  if (card.encryptionKey !== keys.encryptionKey || card.signingKey !== keys.signingKey) {
    throw new Error("The card is not for this identity");
  }
  const key = await fingerprint(keys.encryptionKey, keys.signingKey);
  readShareIndexDocMembers(doc).set(key, { ...card });
}

/** Removes the identity's card while invitations are off. */
export async function removeOwnCard(doc: Doc, identity: Identity): Promise<void> {
  const keys = await publicKeys(identity);
  readShareIndexDocMembers(doc).delete(await fingerprint(keys.encryptionKey, keys.signingKey));
}

function hasCardShape(value: Record<string, unknown>): boolean {
  return typeof value.name === "string"
    && (value.email === undefined || typeof value.email === "string")
    && typeof value.inboxUrl === "string"
    && typeof value.inboxToken === "string"
    && typeof value.encryptionKey === "string"
    && typeof value.signingKey === "string"
    && typeof value.updated === "number" && Number.isFinite(value.updated)
    && typeof value.sig === "string";
}

async function validCard(key: string, value: unknown): Promise<ContactCard | undefined> {
  if (!isRecord(value) || !hasCardShape(value)) { return undefined; }
  const card = value as ContactCard;
  try {
    if (await fingerprint(card.encryptionKey, card.signingKey) !== key) { return undefined; }
    return await verifyObject(card.signingKey, card as JsonObject) ? card : undefined;
  } catch {
    return undefined;
  }
}

/** The valid cards of the members map; unsigned, malformed, misnamed and foreign-signed entries are dropped. */
export async function readMembers(doc: Doc): Promise<Member[]> {
  const entries = [...readShareIndexDocMembers(doc).entries()];
  const checked = await Promise.all(entries.map(async ([key, value]) => ({ fingerprint: key, card: await validCard(key, value) })));
  return checked.flatMap((entry) => (entry.card ? [{ fingerprint: entry.fingerprint, card: entry.card }] : []));
}

export interface Contact {
  name: string;
  email?: string;
  inboxUrl: string;
  inboxToken: string;
  encryptionKey: string;
  signingKey: string;
  updated: number;
  fingerprint: string;
}

/** Device-local contacts; implemented by the host's storage. */
export interface ContactsStore {
  read(): Promise<Contact[]>;
  write(contacts: Contact[]): Promise<void>;
}

export function memoryContactsStore(initial: Contact[] = []): ContactsStore {
  let contacts = initial.map((contact) => ({ ...contact }));
  return {
    read: async () => contacts.map((contact) => ({ ...contact })),
    write: async (next) => { contacts = next.map((contact) => ({ ...contact })); },
  };
}

interface ContactChange {
  email: string;
  pinned: Contact;
  offered: ContactCard;
}

export interface AddedContacts {
  added: Contact[];
  updated: Contact[];
  changed: ContactChange[];
}

const pinKey = (value: { email?: string; fingerprint: string }): string => (value.email ? `email:${value.email.toLowerCase()}` : `fingerprint:${value.fingerprint}`);

function toContact(member: Member): Contact {
  const { name, email, inboxUrl, inboxToken, encryptionKey, signingKey, updated } = member.card;
  return { name, ...(email === undefined ? {} : { email }), inboxUrl, inboxToken, encryptionKey, signingKey, updated, fingerprint: member.fingerprint };
}

/** Pins the first keys per lowercased email; a later card with other keys is reported as changed and not adopted. */
export async function addMemberContacts(store: ContactsStore, cards: readonly Member[]): Promise<AddedContacts> {
  const contacts = await store.read();
  const result: AddedContacts = { added: [], updated: [], changed: [] };
  for (const member of cards) {
    const incoming = toContact(member);
    const index = contacts.findIndex((contact) => pinKey(contact) === pinKey(incoming));
    const pinned = contacts[index];
    if (!pinned) {
      contacts.push(incoming);
      result.added.push(incoming);
    } else if (pinned.encryptionKey !== incoming.encryptionKey || pinned.signingKey !== incoming.signingKey) {
      result.changed.push({ email: (incoming.email ?? "").toLowerCase(), pinned, offered: member.card });
    } else if (incoming.updated > pinned.updated) {
      contacts[index] = incoming;
      result.updated.push(incoming);
    }
  }
  if (result.added.length > 0 || result.updated.length > 0) { await store.write(contacts); }
  return result;
}

/** Contacts whose name or email matches the query, case-insensitively; prefix matches come before substring matches. */
export function suggestContacts(contacts: readonly Contact[], query: string, limit = 8): Contact[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") { return []; }
  const prefix: Contact[] = [];
  const inside: Contact[] = [];
  for (const contact of contacts) {
    const fields = [contact.name.toLowerCase(), (contact.email ?? "").toLowerCase()];
    if (fields.some((field) => field.startsWith(needle))) { prefix.push(contact); }
    else if (fields.some((field) => field.includes(needle))) { inside.push(contact); }
  }
  return [...prefix, ...inside].slice(0, limit);
}
