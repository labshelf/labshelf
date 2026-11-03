// Shared world for the invitation tests: a fake internet of relay inboxes and the directory, and people with their ports.
import { Doc } from "yjs";
import {
  createInvitations, DIRECTORY_URL,
  type EmailPin, type InvitationPorts, type Invitations, type ShareFlowPorts, type StoredInvite,
} from "../../src/share/index";
import {
  createShareKey, deriveShareId, exportIdentity, fingerprint, formatInvite, generateIdentity, publicKeys, type IdentityJwk,
} from "../../src/collab/index";
import { memoryContactsStore, type Contact } from "../../src/collab/members";
import { inboxToken } from "../../src/collab/relays/relayInbox";
import { encodeRelayBody, type RelayAccount } from "../../src/relay/index";
import type { ShareConnection } from "../../src/collab/session/index";
import type { ProjectEntry } from "../../src/writing/project/index";
import { bytesToBase64Url } from "../../src/encoding/index";
import type { ILogger } from "../../src/ports";

export const logger: ILogger = { log: async () => undefined, error: async () => undefined };

export interface InboxItem { id: string; sealed: Record<string, unknown> & { to: string; expires: number }; from: string; received: number }
export interface Row { inboxUrl: string; inboxToken: string; encryptionKey: string; signingKey: string }

/** One fake internet: relay inboxes by URL and the directory, with every request recorded. */
export class World {
  readonly inboxes = new Map<string, { ownerSecret: string; items: InboxItem[] }>();
  readonly rows = new Map<string, Row>();
  readonly emails = new Map<string, string>();
  readonly seen: { url: string; method: string; body: unknown }[] = [];
  directoryDown = false;
  unauthorized = new Set<string>();
  clock = 1_000_000;

  readonly fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" && init.body !== "" ? JSON.parse(init.body) : undefined;
    const auth = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
    this.seen.push({ url, method, body });
    return url.startsWith(DIRECTORY_URL) ? this.directory(url.slice(DIRECTORY_URL.length), auth, body) : this.inbox(url, method, auth, body);
  }) as typeof fetch;

  private json(status: number, value: unknown): Response {
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  }

  private async directory(path: string, token: string, body: Record<string, unknown> | undefined): Promise<Response> {
    if (this.directoryDown) { return this.json(400, { error: "unavailable" }); }
    const email = this.emails.get(token);
    if (!email || this.unauthorized.has(token)) { return this.json(401, { error: "unauthorized" }); }
    if (path === "/register") { this.rows.set(email, body as unknown as Row); return this.json(200, { ok: true }); }
    if (path === "/unregister") { this.rows.delete(email); return this.json(200, { ok: true }); }
    if (!this.rows.has(email)) { return this.json(401, { error: "unauthorized" }); }
    const row = this.rows.get(String(body?.["email"]).toLowerCase());
    if (!row) { return this.json(404, { error: "not_found" }); }
    if (path === "/lookup") {
      return this.json(200, { encryptionKey: row.encryptionKey, signingKey: row.signingKey, fingerprint: await fingerprint(row.encryptionKey, row.signingKey) });
    }
    const sealed = body?.["sealed"] as InboxItem["sealed"];
    const answer = await this.inbox(`${row.inboxUrl}/inbox`, "POST", row.inboxToken, { sealed, from: "directory" });
    return answer.ok ? this.json(200, { ok: true }) : this.json(400, { error: "unavailable" });
  }

  private async inbox(url: string, method: string, token: string, body: unknown): Promise<Response> {
    const match = /^(https:\/\/[^/]+)\/inbox(?:\/(.+))?$/.exec(url);
    const inbox = match ? this.inboxes.get(match[1]!) : undefined;
    if (!match || !inbox) { return this.json(404, { v: "2.1", error: "notFound" }); }
    if (method === "POST") {
      const { sealed, from } = body as { sealed: InboxItem["sealed"]; from: string };
      if (token !== await inboxToken(inbox.ownerSecret, sealed.to)) { return this.json(403, { v: "2.1", error: "forbidden" }); }
      const id = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
      inbox.items.push({ id, sealed, from: from === "directory" ? sealed.to : from, received: this.clock });
      return new Response(encodeRelayBody({ id }), { status: 200 });
    }
    if (token !== inbox.ownerSecret) { return this.json(403, { v: "2.1", error: "forbidden" }); }
    if (method === "GET") { return new Response(encodeRelayBody({ invites: inbox.items }), { status: 200 }); }
    inbox.items = inbox.items.filter((item) => item.id !== decodeURIComponent(match[2] ?? ""));
    return new Response(encodeRelayBody({}), { status: 200 });
  }

  directoryCalls(): string[] {
    return this.seen.filter((s) => s.url.startsWith(DIRECTORY_URL)).map((s) => s.url.slice(DIRECTORY_URL.length));
  }
}

export interface Person {
  name: string;
  email: string;
  jwk: IdentityJwk;
  fingerprint: string;
  account: RelayAccount;
  enabled: boolean;
  contacts: ReturnType<typeof memoryContactsStore>;
  pins: EmailPin[];
  keys: Map<string, StoredInvite>;
  open: Map<string, ShareConnection>;
  connected: StoredInvite[];
  order: string[];
  entries: ProjectEntry[];
  ports: ShareFlowPorts;
  invitations: Invitations;
}

export async function person(world: World, name: string, options: { invitations?: boolean; relay?: boolean } = {}): Promise<Person> {
  const identity = await generateIdentity();
  const jwk = await exportIdentity(identity);
  const keys = await publicKeys(identity);
  const relayUrl = `https://${name}.relay.example`;
  const account = { relayUrl, ownerSecret: `${name}-owner-secret` } as RelayAccount;
  world.inboxes.set(relayUrl, { ownerSecret: account.ownerSecret, items: [] });
  const email = `${name}@example.org`;
  world.emails.set(`token-${name}`, email);
  const p = {
    name, email, jwk, account, enabled: false, contacts: memoryContactsStore(), pins: [],
    keys: new Map(), open: new Map(), connected: [], order: [], entries: [],
    fingerprint: await fingerprint(keys.encryptionKey, keys.signingKey),
  } as unknown as Person;
  let stored: IdentityJwk | undefined = jwk;
  const invitationPorts: InvitationPorts = {
    identity: { load: async () => stored, save: async (next) => { stored = next; } },
    contacts: p.contacts,
    enabled: { get: async () => p.enabled, set: async (on) => { p.enabled = on; } },
    emailPins: { read: async () => p.pins.map((pin) => ({ ...pin })), write: async (next) => { p.pins = next.map((pin) => ({ ...pin })); } },
    accessToken: async () => `token-${name}`,
    now: () => world.clock,
  };
  p.ports = {
    keys: {
      remember: async (invite) => { p.order.push("remember"); p.keys.set(invite.shareId, invite); },
      invite: async (shareId) => p.keys.get(shareId),
      forget: async (shareId) => { p.keys.delete(shareId); },
    },
    shares: {
      active: (shareId) => p.open.get(shareId),
      list: () => [...p.open.values()],
      isBusy: () => false,
      hold: async (_shareId, run) => run(),
      add: (connection) => { p.order.push("add"); p.open.set(connection.shareId, connection); },
      remove: async (shareId) => { p.open.delete(shareId); },
    },
    projects: { list: () => p.entries, reload: async () => undefined },
    files: {} as ShareFlowPorts["files"],
    relay: { get: async () => (options.relay === false ? undefined : p.account) },
    requireRelay: async () => false,
    connect: async (invite) => {
      p.order.push("connect");
      p.connected.push(invite);
      const folder = `projects/${invite.shareId.slice(0, 6)}`;
      p.entries = [...p.entries, { kind: "ready", folder, location: "library", settings: { shared: invite.shareId, title: "Paper" }, main: undefined } as unknown as ProjectEntry];
      return { shareId: invite.shareId, shareKey: invite.shareKey, folder, session: { index: new Doc() } } as unknown as ShareConnection;
    },
    deleteState: async () => undefined,
    userName: () => name,
    logger,
    fetch: world.fetch,
    ...(options.invitations === false ? {} : { invitations: invitationPorts }),
  };
  p.invitations = createInvitations(p.ports);
  return p;
}

export async function contactOf(p: Person): Promise<Contact> {
  const keys = await publicKeys(await (await import("../../src/collab/index")).importIdentity(p.jwk));
  return {
    name: p.name, email: p.email, inboxUrl: p.account.relayUrl, inboxToken: await inboxToken(p.account.ownerSecret, p.fingerprint),
    ...keys, updated: 1, fingerprint: p.fingerprint,
  };
}

export async function newInvite(): Promise<{ link: string; shareId: string }> {
  const shareKey = createShareKey();
  return { link: await formatInvite({ shareKey, relays: [{ url: "https://share.relay.example" }] }), shareId: await deriveShareId(shareKey) };
}

export async function setup() {
  const world = new World();
  const alice = await person(world, "alice");
  const bob = await person(world, "bob");
  return { world, alice, bob };
}

