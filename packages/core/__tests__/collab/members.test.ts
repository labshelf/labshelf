import { Doc } from "yjs";
import { generateIdentity, type Identity } from "../../src/collab/index.js";
import { addMemberContacts, memoryContactsStore, readMembers, removeOwnCard, signCard, suggestContacts, writeOwnCard, type Contact, type Member } from "../../src/collab/members.js";
import { readShareIndexDocFiles, readShareIndexDocKind, readShareIndexDocMembers, createShareIndexDoc } from "../../src/collab/shareIndexDoc.js";

const fields = { name: "Ada", email: "Ada@Example.com", inboxUrl: "https://relay.example/inbox/1", inboxToken: "tok" };

async function member(identity: Identity, overrides: Partial<typeof fields> = {}, now = 1000, omitEmail = false): Promise<Member> {
  const doc = new Doc();
  const { email: _email, ...withoutEmail } = fields;
  await writeOwnCard(doc, identity, await signCard(identity, omitEmail ? { ...withoutEmail, ...overrides } : { ...fields, ...overrides }, now));
  const [first] = await readMembers(doc);
  if (!first) { throw new Error("no member"); }
  return first;
}

describe("members map", () => {
  it("reads a valid own card and keeps unknown keys", async () => {
    const identity = await generateIdentity();
    const doc = new Doc();
    await writeOwnCard(doc, identity, await signCard(identity, { ...fields, extra: { a: 1 } }, 5));
    const members = await readMembers(doc);
    expect(members).toHaveLength(1);
    expect(members[0]?.card).toMatchObject({ name: "Ada", updated: 5, extra: { a: 1 } });
  });

  it("drops a card whose unknown key was changed after signing", async () => {
    const identity = await generateIdentity();
    const doc = new Doc();
    const card = await signCard(identity, { ...fields, extra: { a: 1 } });
    await writeOwnCard(doc, identity, { ...card, extra: { a: 2 } });
    expect(await readMembers(doc)).toEqual([]);
  });

  it("refuses to write a card with another identity's keys", async () => {
    const [a, b] = [await generateIdentity(), await generateIdentity()];
    await expect(writeOwnCard(new Doc(), a, await signCard(b, fields))).rejects.toThrow();
  });

  it("removes the own card", async () => {
    const identity = await generateIdentity();
    const doc = new Doc();
    await writeOwnCard(doc, identity, await signCard(identity, fields));
    await removeOwnCard(doc, identity);
    expect(await readMembers(doc)).toEqual([]);
  });

  it("drops unsigned, tampered, misnamed, malformed and foreign-signed cards", async () => {
    const [a, b, c] = [await generateIdentity(), await generateIdentity(), await generateIdentity()];
    const doc = new Doc();
    const map = readShareIndexDocMembers(doc);
    const good = await member(a);
    const other = await member(b);
    map.set(good.fingerprint, good.card);
    const { sig: _sig, ...unsigned } = (await member(b)).card;
    map.set("unsigned", unsigned);
    map.set(other.fingerprint, { ...other.card, name: "Mallory" });
    map.set("misnamed", other.card);
    const foreign = await signCard(c, fields);
    map.set(other.fingerprint + "x", { ...foreign, signingKey: other.card.signingKey });
    map.set("garbage", "text");
    map.set("missing", { name: "x" });
    const cardC = await member(c, { name: "Eve" });
    map.set(cardC.fingerprint, { ...cardC.card, updated: "now" });
    expect((await readMembers(doc)).map((m) => m.fingerprint)).toEqual([good.fingerprint]);
  });

  it("opens an index doc with members, even garbage, and an old doc without any", async () => {
    const doc = new Doc();
    expect(await readMembers(doc)).toEqual([]);
    createShareIndexDoc(doc);
    readShareIndexDocMembers(doc).set("junk", 12);
    expect(readShareIndexDocKind(doc)).toEqual({ ok: true, kind: "project" });
    expect(readShareIndexDocFiles(doc).size).toBe(0);
  });
});

describe("contacts store", () => {
  it("pins the first keys per lowercased email and reports a change without adopting it", async () => {
    const store = memoryContactsStore();
    const first = await member(await generateIdentity());
    expect((await addMemberContacts(store, [first])).added).toHaveLength(1);
    const impostor = await member(await generateIdentity(), { email: "ADA@example.com", name: "Not Ada" }, 2000);
    const result = await addMemberContacts(store, [impostor]);
    expect(result.added).toEqual([]);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({ email: "ada@example.com", offered: impostor.card });
    expect(result.changed[0]?.pinned.encryptionKey).toBe(first.card.encryptionKey);
    const stored = await store.read();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe("Ada");
  });

  it("replaces the name and inbox of the same keys with a newer card only", async () => {
    const identity = await generateIdentity();
    const store = memoryContactsStore();
    await addMemberContacts(store, [await member(identity, {}, 1000)]);
    const older = await addMemberContacts(store, [await member(identity, { name: "Old" }, 500)]);
    expect(older.updated).toEqual([]);
    const newer = await addMemberContacts(store, [await member(identity, { name: "Ada L", inboxUrl: "https://relay.example/inbox/2" }, 3000)]);
    expect(newer.updated).toHaveLength(1);
    expect((await store.read())[0]).toMatchObject({ name: "Ada L", inboxUrl: "https://relay.example/inbox/2", updated: 3000 });
  });

  it("keys cards without an email by fingerprint", async () => {
    const store = memoryContactsStore();
    const a = await member(await generateIdentity(), {}, 1000, true);
    const b = await member(await generateIdentity(), {}, 1000, true);
    const result = await addMemberContacts(store, [a, b]);
    expect(result.added).toHaveLength(2);
    expect(result.changed).toEqual([]);
  });
});

describe("suggestContacts", () => {
  const contact = (name: string, email?: string): Contact => ({ name, ...(email ? { email } : {}), inboxUrl: "u", inboxToken: "t", encryptionKey: "e", signingKey: "s", updated: 1, fingerprint: name });
  const contacts = [contact("Grace Ada", "g@x.org"), contact("Adam", "adam@x.org"), contact("Bob", "bob@ada.org")];

  it("matches case-insensitively with prefix matches first", () => {
    expect(suggestContacts(contacts, "AD").map((c) => c.name)).toEqual(["Adam", "Grace Ada", "Bob"]);
  });

  it("returns nothing for an empty query and honors the limit", () => {
    expect(suggestContacts(contacts, "  ")).toEqual([]);
    expect(suggestContacts(contacts, "a", 2)).toHaveLength(2);
  });
});
