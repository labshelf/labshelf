// Tests invitations by email: sending (direct to a contact, through the directory, the link fallback), the inbox (refresh, accept,
// decline), enabling and disabling with the directory registration and cards, and every new op over the sharing channel.
import { Doc } from "yjs";
import {
  createInvitations, createShareClient, createShareHost, serveShare, DIRECTORY_URL,
  type EmailPin, type InvitationPorts, type Invitations, type ShareCall, type ShareFlowPorts, type ShareHost, type ShareReply, type StoredInvite,
} from "../../src/share/index";
import {
  createShareKey, deriveShareId, exportIdentity, fingerprint, formatInvite, generateIdentity, importIdentity, publicKeys, sealInvite, type IdentityJwk,
} from "../../src/collab/invite/index";
import { memoryContactsStore, readMembers, type Contact } from "../../src/collab/members";
import { inboxToken } from "../../src/collab/relays/relayInbox";
import { encodeRelayBody, type RelayAccount } from "../../src/relay/index";
import type { ShareConnection } from "../../src/collab/session/index";
import type { ProjectEntry } from "../../src/writing/project/index";
import { createLoopbackTransport } from "../../src/libraryUi/protocol";
import { bytesToBase64Url } from "../../src/encoding/index";
import type { ILogger } from "../../src/ports";

const NOT_FOUND = "No LabShelf invitations for this email; copy the invite link instead";
const logger: ILogger = { log: async () => undefined, error: async () => undefined };

interface InboxItem { id: string; sealed: Record<string, unknown> & { to: string; expires: number }; from: string; received: number }
interface Row { inboxUrl: string; inboxToken: string; encryptionKey: string; signingKey: string }

/** One fake internet: relay inboxes by URL and the directory, with every request recorded. */
class World {
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

interface Person {
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

async function person(world: World, name: string, options: { invitations?: boolean; relay?: boolean } = {}): Promise<Person> {
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

async function contactOf(p: Person): Promise<Contact> {
  const keys = await publicKeys(await (await import("../../src/collab/invite/index")).importIdentity(p.jwk));
  return {
    name: p.name, email: p.email, inboxUrl: p.account.relayUrl, inboxToken: await inboxToken(p.account.ownerSecret, p.fingerprint),
    ...keys, updated: 1, fingerprint: p.fingerprint,
  };
}

async function newInvite(): Promise<{ link: string; shareId: string }> {
  const shareKey = createShareKey();
  return { link: await formatInvite({ shareKey, relays: [{ url: "https://share.relay.example" }] }), shareId: await deriveShareId(shareKey) };
}

async function setup() {
  const world = new World();
  const alice = await person(world, "alice");
  const bob = await person(world, "bob");
  return { world, alice, bob };
}

describe("inviteByEmail", () => {
  it("posts straight to a contact's inbox without asking the directory", async () => {
    const { world, alice, bob } = await setup();
    alice.enabled = true;
    await alice.contacts.write([await contactOf(bob)]);
    const { link } = await newInvite();
    await expect(alice.invitations.inviteByEmail({ link, title: "Paper", email: "BOB@example.org" })).resolves.toEqual({ sent: "direct" });
    expect(world.directoryCalls()).toEqual([]);
    bob.enabled = true;
    const list = await bob.invitations.refreshInvitations();
    expect(list).toEqual([expect.objectContaining({ title: "Paper", from: expect.objectContaining({ name: "alice", fingerprint: alice.fingerprint }) })]);
  });

  it("goes through the directory when no contact matches", async () => {
    const { world, alice, bob } = await setup();
    await bob.invitations.setInvitationsEnabled(true);
    await alice.invitations.setInvitationsEnabled(true);
    const { link } = await newInvite();
    await expect(alice.invitations.inviteByEmail({ link, title: "Paper", email: bob.email })).resolves.toEqual({ sent: "directory" });
    expect(world.directoryCalls()).toEqual(["/register", "/register", "/lookup", "/send"]);
    expect(world.inboxes.get(bob.account.relayUrl)?.items).toHaveLength(1);
  });

  it("falls back to the link with the exact message for an email the directory does not know", async () => {
    const { alice } = await setup();
    await alice.invitations.setInvitationsEnabled(true);
    const { link } = await newInvite();
    await expect(alice.invitations.inviteByEmail({ link, title: "Paper", email: "nobody@example.org" }))
      .resolves.toEqual({ fallback: "link", link, message: NOT_FOUND });
  });

  it("falls back to the link on a refusal by the directory or the inbox, and when invitations are off", async () => {
    const { world, alice, bob } = await setup();
    const { link } = await newInvite();
    await expect(alice.invitations.inviteByEmail({ link, title: "Paper", email: bob.email })).resolves.toMatchObject({ fallback: "link", link });
    await alice.invitations.setInvitationsEnabled(true);
    world.directoryDown = true;
    await expect(alice.invitations.inviteByEmail({ link, title: "Paper", email: bob.email })).resolves.toMatchObject({ fallback: "link", link });
    await alice.contacts.write([{ ...(await contactOf(bob)), inboxToken: "wrong" }]);
    await expect(alice.invitations.inviteByEmail({ link, title: "Paper", email: bob.email })).resolves.toMatchObject({ fallback: "link", link });
    const off = await person(world, "carol", { invitations: false });
    await expect(off.invitations.inviteByEmail({ link, title: "Paper", email: bob.email })).resolves.toMatchObject({ fallback: "link", link });
  });
});

async function sendTo(world: World, alice: Person, bob: Person, title = "Paper") {
  alice.enabled = true;
  bob.enabled = true;
  await alice.contacts.write([await contactOf(bob)]);
  const invite = await newInvite();
  await alice.invitations.inviteByEmail({ link: invite.link, title, email: bob.email });
  world.clock += 61_000;
  const [view] = await bob.invitations.refreshInvitations();
  return { invite, view: view! };
}

describe("the inbox", () => {
  it("accepts by joining from the decoded invite, storing the key after connecting, and deleting the entry", async () => {
    const { world, alice, bob } = await setup();
    const { invite, view } = await sendTo(world, alice, bob);
    const changes: unknown[] = [];
    bob.invitations.onInvitationsChange((list) => changes.push(list));
    const outcome = await bob.invitations.acceptInvitation(view.id, new AbortController().signal);
    expect(outcome).toEqual({ kind: "joined", folder: `projects/${invite.shareId.slice(0, 6)}` });
    expect(bob.connected.map((i) => i.shareId)).toEqual([invite.shareId]);
    expect(bob.order).toEqual(["connect", "add", "remember"]);
    expect(world.inboxes.get(bob.account.relayUrl)?.items).toEqual([]);
    expect(changes).toEqual([[]]);
    const index = bob.open.get(invite.shareId)!.session.index;
    expect((await readMembers(index)).map((m) => m.fingerprint)).toEqual([bob.fingerprint]);
  });

  it("declines by deleting only", async () => {
    const { world, alice, bob } = await setup();
    const { view } = await sendTo(world, alice, bob);
    await bob.invitations.declineInvitation(view.id);
    expect(bob.connected).toEqual([]);
    expect(world.inboxes.get(bob.account.relayUrl)?.items).toEqual([]);
    await expect(bob.invitations.invitations()).resolves.toEqual([]);
  });

  it("drops an envelope that does not open", async () => {
    const { world, bob } = await setup();
    bob.enabled = true;
    const stranger = await generateIdentity();
    const sealed = await sealInvite({
      sender: stranger, card: { ...(await publicKeys(stranger)) }, recipient: { encryptionKey: (await publicKeys(stranger)).encryptionKey, fingerprint: bob.fingerprint },
      link: (await newInvite()).link, title: "Spoof", now: world.clock,
    });
    world.inboxes.get(bob.account.relayUrl)!.items.push({ id: bytesToBase64Url(new Uint8Array(32).fill(7)), sealed: { ...sealed }, from: bob.fingerprint, received: 1 });
    await expect(bob.invitations.refreshInvitations()).resolves.toEqual([]);
    expect(world.inboxes.get(bob.account.relayUrl)?.items).toEqual([]);
  });

  it("reads the inbox at most once a minute and is empty while off", async () => {
    const { world, alice, bob } = await setup();
    await sendTo(world, alice, bob);
    const reads = () => world.seen.filter((s) => s.method === "GET").length;
    const before = reads();
    await bob.invitations.refreshInvitations();
    await bob.invitations.invitations();
    expect(reads()).toBe(before);
    world.clock += 61_000;
    await bob.invitations.refreshInvitations();
    expect(reads()).toBe(before + 1);
    const off = await person(world, "dave", { invitations: false });
    await expect(off.invitations.invitations()).resolves.toEqual([]);
  });
});

describe("enabling invitations", () => {
  it("registers the inbox token of the owner secret and fingerprint with the public keys", async () => {
    const { world, alice } = await setup();
    await alice.invitations.setInvitationsEnabled(true);
    const keys = await publicKeys(await (await import("../../src/collab/invite/index")).importIdentity(alice.jwk));
    expect(world.rows.get(alice.email)).toEqual({
      inboxUrl: alice.account.relayUrl, inboxToken: await inboxToken(alice.account.ownerSecret, alice.fingerprint), ...keys,
    });
    await expect(alice.invitations.invitationsEnabled()).resolves.toBe(true);
  });

  it("reports the not-available message and stays off when the directory refuses the token", async () => {
    const { world, alice } = await setup();
    world.unauthorized.add("token-alice");
    await expect(alice.invitations.setInvitationsEnabled(true)).rejects.toThrow("Invitations by email are not available yet");
    expect(alice.enabled).toBe(false);
  });

  it("disables by unregistering, saving off and removing the own card from connected shares", async () => {
    const { world, alice } = await setup();
    await alice.invitations.setInvitationsEnabled(true);
    const index = new Doc();
    const connection = { shareId: "s1", folder: "projects/s1", session: { index } } as unknown as ShareConnection;
    alice.open.set("s1", connection);
    await alice.invitations.publishCard(connection);
    expect(await readMembers(index)).toHaveLength(1);
    await alice.invitations.setInvitationsEnabled(false);
    expect(world.directoryCalls()).toEqual(["/register", "/unregister"]);
    expect(alice.enabled).toBe(false);
    expect(await readMembers(index)).toEqual([]);
  });

  it("refuses without a relay account and treats a missing port as off", async () => {
    const world = new World();
    const noRelay = await person(world, "erin", { relay: false });
    await expect(noRelay.invitations.setInvitationsEnabled(true)).rejects.toThrow("Connect Cloudflare first");
    await expect(noRelay.invitations.invitationsEnabled()).resolves.toBe(false);
    const noPort = await person(world, "frank", { invitations: false });
    await expect(noPort.invitations.setInvitationsEnabled(true)).rejects.toThrow();
    await expect(noPort.invitations.contacts()).resolves.toEqual([]);
  });

  it("moves the registration and the cards to the new relay after a rotation", async () => {
    const { world, alice } = await setup();
    await alice.invitations.setInvitationsEnabled(true);
    const index = new Doc();
    alice.open.set("s1", { shareId: "s1", folder: "projects/s1", session: { index } } as unknown as ShareConnection);
    alice.account = { relayUrl: "https://alice2.relay.example", ownerSecret: "new-secret" } as RelayAccount;
    await alice.invitations.updateAfterRotation({ previousUrl: "https://alice.relay.example", relayUrl: "https://alice2.relay.example" });
    expect(world.rows.get(alice.email)?.inboxUrl).toBe("https://alice2.relay.example");
    expect(world.rows.get(alice.email)?.inboxToken).toBe(await inboxToken("new-secret", alice.fingerprint));
    const [member] = await readMembers(index);
    expect(member?.card.inboxUrl).toBe("https://alice2.relay.example");
  });
});

describe("invitations over the sharing channel", () => {
  function connect(host: ShareHost) {
    const pair = createLoopbackTransport<ShareCall, ShareReply>();
    serveShare(host, pair.host, logger);
    return createShareClient(pair.ui);
  }

  it("round-trips every new op", async () => {
    const view = { id: "i1", title: "Paper", from: { name: "alice", fingerprint: "fp" }, created: 1, expires: 2 };
    const seen: unknown[] = [];
    const host = {
      place: "this device", offers: () => ({ projects: true, links: false }), onOffersChange: () => () => undefined,
      onInvitationsChange: () => () => undefined,
      invitations: async () => [view],
      acceptInvitation: async (id: string, signal: AbortSignal) => { seen.push(["accept", id, signal instanceof AbortSignal]); return { kind: "joined", id: "p", name: "Paper" }; },
      declineInvitation: async (id: string) => { seen.push(["decline", id]); },
      inviteByEmail: async (projectId: string, email: string) => { seen.push(["invite", projectId, email]); return { sent: "direct" }; },
      contacts: async () => [{ name: "bob", email: "bob@example.org", fingerprint: "f", inboxToken: "secret", encryptionKey: "e" }],
      invitationsEnabled: async () => true,
      setInvitationsEnabled: async (on: boolean) => { seen.push(["enable", on]); },
    } as unknown as ShareHost;
    const client = connect(host);
    await expect(client.invitations()).resolves.toEqual([view]);
    await expect(client.acceptInvitation("i1", new AbortController().signal)).resolves.toEqual({ kind: "joined", id: "p", name: "Paper" });
    await expect(client.declineInvitation("i1")).resolves.toBeUndefined();
    await expect(client.inviteByEmail("p", "bob@example.org")).resolves.toEqual({ sent: "direct" });
    await expect(client.contacts()).resolves.toEqual([{ name: "bob", email: "bob@example.org", fingerprint: "f" }]);
    await expect(client.invitationsEnabled()).resolves.toBe(true);
    await expect(client.setInvitationsEnabled(false)).resolves.toBeUndefined();
    expect(seen).toEqual([["accept", "i1", true], ["decline", "i1"], ["invite", "p", "bob@example.org"], ["enable", false]]);
  });

  it("fires onInvitationsChange on the client after a refresh that changed the list", async () => {
    const { world, alice, bob } = await setup();
    const host = createShareHost({
      place: "this device", logger, invitations: bob.invitations,
      projects: { ports: bob.ports, idOf: (entry) => entry.folder, open: async () => undefined },
      clipboard: { write: async () => undefined }, openLink: async () => undefined,
    });
    const client = connect(host);
    const heard: unknown[] = [];
    client.onInvitationsChange((list) => heard.push(list));
    alice.enabled = true;
    bob.enabled = true;
    await bob.invitations.refreshInvitations();
    expect(heard).toEqual([]);
    await alice.contacts.write([await contactOf(bob)]);
    await alice.invitations.inviteByEmail({ link: (await newInvite()).link, title: "Paper", email: bob.email });
    world.clock += 61_000;
    await bob.invitations.refreshInvitations();
    expect(heard).toEqual([[expect.objectContaining({ title: "Paper" })]]);
    const [view] = heard[0] as { id: string }[];
    await expect(client.acceptInvitation(view!.id, new AbortController().signal)).resolves.toMatchObject({ kind: "joined", name: "Paper" });
  });
});

/** Posts an invitation from `sender`, whose card claims what the test passes, straight into the recipient's inbox. */
async function postClaiming(world: World, to: Person, claims: Record<string, string>) {
  const sender = await generateIdentity();
  const keys = await publicKeys(sender);
  const recipient = await publicKeys(await importIdentity(to.jwk));
  const sealed = await sealInvite({
    sender, card: { ...keys, name: "Eve", ...claims }, recipient: { encryptionKey: recipient.encryptionKey, fingerprint: to.fingerprint },
    link: (await newInvite()).link, title: "Claimed", now: world.clock,
  });
  world.inboxes.get(to.account.relayUrl)!.items.push({ id: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))), sealed: { ...sealed }, from: "x", received: world.clock });
  return { keys, fingerprint: await fingerprint(keys.encryptionKey, keys.signingKey) };
}

describe("email pins", () => {
  it("sends direct, without the directory, once the pinned recipient appears as a member card", async () => {
    const { world, alice, bob } = await setup();
    await alice.invitations.setInvitationsEnabled(true);
    await bob.invitations.setInvitationsEnabled(true);
    const index = new Doc();
    const connection = { shareId: "s1", folder: "projects/s1", session: { index } } as unknown as ShareConnection;
    alice.open.set("s1", connection);
    const { link } = await newInvite();
    await expect(alice.invitations.inviteByEmail({ link, title: "Paper", email: bob.email })).resolves.toEqual({ sent: "directory" });
    expect(alice.pins).toEqual([expect.objectContaining({ email: bob.email, fingerprint: bob.fingerprint })]);
    expect(await alice.contacts.read()).toEqual([]);
    await bob.invitations.publishCard(connection);
    world.seen.length = 0;
    await expect(alice.invitations.inviteByEmail({ link, title: "Again", email: bob.email.toUpperCase() })).resolves.toEqual({ sent: "direct" });
    expect(world.directoryCalls()).toEqual([]);
    expect(world.inboxes.get(bob.account.relayUrl)?.items).toHaveLength(2);
    expect((await alice.contacts.read()).every((contact) => contact.email === undefined)).toBe(true);
  });

  it("keeps the first pin when the directory later answers with other keys, and still sends through the directory", async () => {
    const { world, alice, bob } = await setup();
    await alice.invitations.setInvitationsEnabled(true);
    await bob.invitations.setInvitationsEnabled(true);
    const { link } = await newInvite();
    await alice.invitations.inviteByEmail({ link, title: "One", email: bob.email });
    const [first] = alice.pins;
    const other = await publicKeys(await generateIdentity());
    world.rows.set(bob.email, { ...world.rows.get(bob.email)!, ...other });
    const warned: unknown[][] = [];
    const watching = createInvitations({ ...alice.ports, logger: { ...logger, log: async (...args: unknown[]) => { warned.push(args); } } as ILogger });
    // The fake directory cannot seal to keys bob never had, so the send itself may be refused; the pin and the warning are what matter.
    await watching.inviteByEmail({ link, title: "Two", email: bob.email });
    expect(world.directoryCalls().at(-1)).toBe("/send");
    expect(alice.pins).toEqual([first]);
    expect(warned.some((args) => args[0] === "WARN")).toBe(true);
    expect(world.directoryCalls().filter((call) => call === "/lookup")).toHaveLength(2);
  });

  it("keeps pins in memory when the app gives no pin store", async () => {
    const { world, alice, bob } = await setup();
    const { emailPins: _store, ...withoutPins } = alice.ports.invitations!;
    const bare = createInvitations({ ...alice.ports, invitations: withoutPins });
    await bare.setInvitationsEnabled(true);
    await bob.invitations.setInvitationsEnabled(true);
    const { link } = await newInvite();
    await expect(bare.inviteByEmail({ link, title: "One", email: bob.email })).resolves.toEqual({ sent: "directory" });
    expect(alice.pins).toEqual([]);
    expect(world.directoryCalls()).toContain("/send");
  });
});

describe("what leaves the invitations", () => {
  it("lists contacts as name, email and fingerprint only, taking a missing email from a local pin", async () => {
    const { alice, bob } = await setup();
    alice.enabled = true;
    const withEmail = await contactOf(bob);
    const { email: _email, ...rest } = await contactOf(bob);
    const carol: Contact = { ...rest, name: "Carol", fingerprint: "carol-fp", encryptionKey: "ce", signingKey: "cs" };
    await alice.contacts.write([withEmail, carol]);
    alice.pins = [{ email: "carol@example.org", fingerprint: "carol-fp", encryptionKey: "ce", signingKey: "cs", pinned: 1 }];
    await expect(alice.invitations.contacts()).resolves.toEqual([
      { name: "bob", email: bob.email, fingerprint: bob.fingerprint },
      { name: "Carol", email: "carol@example.org", fingerprint: "carol-fp" },
    ]);
  });

  it("strips anything else a host returns before it crosses the channel", async () => {
    const host = {
      place: "x", offers: () => ({ projects: true, links: false }), onOffersChange: () => () => undefined, onInvitationsChange: () => () => undefined,
      contacts: async () => [{ name: "bob", fingerprint: "f", inboxToken: "secret", inboxUrl: "u", encryptionKey: "e", signingKey: "s" }],
    } as unknown as ShareHost;
    const pair = createLoopbackTransport<ShareCall, ShareReply>();
    serveShare(host, pair.host, logger);
    await expect(createShareClient(pair.ui).contacts()).resolves.toEqual([{ name: "bob", fingerprint: "f" }]);
  });

  it("shows a sender's email only when a local pin or contact names it, never from the sealed card", async () => {
    const { world, alice } = await setup();
    alice.enabled = true;
    const eve = await postClaiming(world, alice, { email: "ceo@big.example" });
    const [claimed] = await alice.invitations.refreshInvitations();
    expect(claimed?.from).toEqual({ name: "Eve", fingerprint: eve.fingerprint });
    alice.pins = [{ email: "eve@example.org", ...eve.keys, fingerprint: eve.fingerprint, pinned: 1 }];
    const [pinned] = await createInvitations(alice.ports).refreshInvitations();
    expect(pinned?.from).toEqual({ name: "Eve", email: "eve@example.org", fingerprint: eve.fingerprint });
    alice.pins = [];
    await alice.contacts.write([{ name: "Eve", email: "eve@work.example", inboxUrl: "u", inboxToken: "t", ...eve.keys, updated: 1, fingerprint: eve.fingerprint }]);
    const [known] = await createInvitations(alice.ports).refreshInvitations();
    expect(known?.from.email).toBe("eve@work.example");
  });
});

describe("failures never stop the rest", () => {
  it("does not throw when the registration fails after a rotation, rewrites the cards, and reads the new inbox next", async () => {
    const { world, alice } = await setup();
    await alice.invitations.setInvitationsEnabled(true);
    const index = new Doc();
    alice.open.set("s1", { shareId: "s1", folder: "projects/s1", session: { index } } as unknown as ShareConnection);
    await alice.invitations.refreshInvitations();
    alice.account = { relayUrl: "https://alice2.relay.example", ownerSecret: "new-secret" } as RelayAccount;
    world.inboxes.set(alice.account.relayUrl, { ownerSecret: "new-secret", items: [] });
    world.directoryDown = true;
    await expect(alice.invitations.updateAfterRotation({ previousUrl: "https://alice.relay.example", relayUrl: alice.account.relayUrl })).resolves.toBeUndefined();
    const [member] = await readMembers(index);
    expect(member?.card.inboxUrl).toBe("https://alice2.relay.example");
    const reads = () => world.seen.filter((s) => s.method === "GET").length;
    const before = reads();
    await alice.invitations.refreshInvitations();
    expect(reads()).toBe(before + 1);
    expect(world.seen.at(-1)?.url).toBe("https://alice2.relay.example/inbox");
  });

  it("does not read a failing inbox again within a minute", async () => {
    const { world, alice } = await setup();
    alice.enabled = true;
    world.inboxes.delete(alice.account.relayUrl);
    const reads = () => world.seen.filter((s) => s.method === "GET").length;
    await alice.invitations.refreshInvitations();
    await alice.invitations.refreshInvitations();
    expect(reads()).toBe(1);
    world.clock += 61_000;
    await alice.invitations.refreshInvitations();
    expect(reads()).toBe(2);
  });
});
