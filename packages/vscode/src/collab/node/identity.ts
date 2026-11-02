// The stores behind invitations by email on the desktop: the library's identity in SecretStorage, its contacts and the switch in global state.
import type * as vscode from "vscode";

import { isContact, isEmailPin, isIdentityJwk, type InvitationPorts } from "@labshelf/core";

const identityKey = (libraryId: string): string => `labshelf.collab.identity.${libraryId}`;
const contactsKey = (libraryId: string): string => `labshelf.collab.contacts.${libraryId}`;
const pinsKey = (libraryId: string): string => `labshelf.collab.emailPins.${libraryId}`;
const enabledKey = (libraryId: string): string => `labshelf.collab.invitationsEnabled.${libraryId}`;

export interface InvitationStoreDeps {
  secrets: vscode.SecretStorage;
  /** The extension's global state, which outlives the window. */
  state: vscode.Memento;
  /** The open library's device identity; each library keeps its own identity, contacts and switch. */
  libraryId(): Promise<string>;
  accessToken(): Promise<string>;
}

/** Malformed values read as absent. */
export function createInvitationPorts(deps: InvitationStoreDeps): InvitationPorts {
  const { secrets, state } = deps;
  return {
    identity: {
      async load() {
        const raw = await secrets.get(identityKey(await deps.libraryId()));
        if (!raw) { return undefined; }
        try {
          const parsed: unknown = JSON.parse(raw);
          return isIdentityJwk(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      },
      async save(jwk) {
        await secrets.store(identityKey(await deps.libraryId()), JSON.stringify(jwk));
      },
    },
    contacts: {
      async read() {
        const stored = state.get<unknown>(contactsKey(await deps.libraryId()));
        return Array.isArray(stored) && stored.every(isContact) ? stored.map((contact) => ({ ...contact })) : [];
      },
      async write(contacts) {
        await state.update(contactsKey(await deps.libraryId()), contacts.map((contact) => ({ ...contact })));
      },
    },
    emailPins: {
      async read() {
        const stored = state.get<unknown>(pinsKey(await deps.libraryId()));
        return Array.isArray(stored) && stored.every(isEmailPin) ? stored.map((pin) => ({ ...pin })) : [];
      },
      async write(pins) {
        await state.update(pinsKey(await deps.libraryId()), pins.map((pin) => ({ ...pin })));
      },
    },
    enabled: {
      async get() {
        return state.get<unknown>(enabledKey(await deps.libraryId())) === true;
      },
      async set(on) {
        await state.update(enabledKey(await deps.libraryId()), on);
      },
    },
    accessToken: () => deps.accessToken(),
  };
}
