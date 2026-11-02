// Keeps the invitation setting of each library in extension storage: its identity with the private keys, its contacts and the switch, apart per library.
import { createAccessTokenReader, isContact, isEmailPin, isIdentityJwk, type InvitationPorts, type RelayAccount, type RelayAccountDeps } from "@labshelf/core";
import { bx } from "../platform";

// INVARIANT: extension-local storage only, since the identity holds private keys; sync storage would copy them to other devices.
// Each record has its own key, so nothing here ever writes `collabShares`.
const identityKey = (libraryId: string): string => `collabIdentity.${libraryId}`;
const contactsKey = (libraryId: string): string => `collabContacts.${libraryId}`;
const pinsKey = (libraryId: string): string => `collabEmailPins.${libraryId}`;
const enabledKey = (libraryId: string): string => `collabInvitationsEnabled.${libraryId}`;

async function readRecord(key: string): Promise<unknown> {
  return ((await bx.storage.local.get(key)) as Record<string, unknown>)[key];
}

export interface BrowserInvitationOptions {
  /** The id of the library open at the time of each call; the user can switch libraries while the page is open. */
  libraryId: () => Promise<string>;
  relay: { get(): Promise<RelayAccount | undefined> };
  /** The relay account's deps, made when the first token is read. */
  relayDeps: () => RelayAccountDeps;
}

/** The invitation port of one page; a missing or malformed record reads as absent. */
export function createBrowserInvitationPorts(options: BrowserInvitationOptions): InvitationPorts {
  const { libraryId, relay } = options;
  const write = async (key: (id: string) => string, value: unknown): Promise<void> => {
    await bx.storage.local.set({ [key(await libraryId())]: value });
  };
  const read = async (key: (id: string) => string): Promise<unknown> => readRecord(key(await libraryId()));
  return {
    identity: {
      load: async () => {
        const stored = await read(identityKey);
        return isIdentityJwk(stored) ? stored : undefined;
      },
      save: (jwk) => write(identityKey, jwk),
    },
    contacts: {
      read: async () => {
        const stored = await read(contactsKey);
        return Array.isArray(stored) && stored.every(isContact) ? stored : [];
      },
      write: (contacts) => write(contactsKey, contacts),
    },
    emailPins: {
      read: async () => {
        const stored = await read(pinsKey);
        return Array.isArray(stored) && stored.every(isEmailPin) ? stored : [];
      },
      write: (pins) => write(pinsKey, pins),
    },
    enabled: {
      get: async () => (await read(enabledKey)) === true,
      set: (on) => write(enabledKey, on),
    },
    accessToken: async () => {
      const account = await relay.get();
      if (!account) { throw new Error("Connect Cloudflare first"); }
      return createAccessTokenReader(options.relayDeps(), account.credential)();
    },
  };
}
