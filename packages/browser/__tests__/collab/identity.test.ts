// The invitation port over extension storage: the identity, contacts and switch of one library survive a restart apart per library, a malformed record reads as absent, and the shares record is never written.
const local: Record<string, unknown> = {};
jest.mock("../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import type { IdentityJwk, InvitationPorts, RelayAccount, RelayAccountDeps } from "@labshelf/core";
import { createBrowserInvitationPorts } from "../../src/collab/pageShares";

type Contact = Awaited<ReturnType<InvitationPorts["contacts"]["read"]>>[number];
const pair = { privateKey: { kty: "EC", d: "secret" }, publicKey: { kty: "EC", x: "x" } };
const JWK = { encryption: pair, signing: pair } as unknown as IdentityJwk;
const CONTACT: Contact = {
  name: "Ada", email: "ada@example.com", inboxUrl: "https://relay.test", inboxToken: "token",
  encryptionKey: "e", signingKey: "s", updated: 1, fingerprint: "f",
};
const account = { credential: { kind: "token", token: "cf-token" } } as unknown as RelayAccount;

describe("browser invitation ports", () => {
  beforeEach(() => { for (const key of Object.keys(local)) delete local[key]; });

  const portsOf = (libraryId: string, relay: RelayAccount | undefined = undefined) => createBrowserInvitationPorts({
    libraryId: async () => libraryId, relay: { get: async () => relay }, relayDeps: () => ({}) as RelayAccountDeps,
  });

  it("re-reads an identity saved earlier, apart per library", async () => {
    await portsOf("browser").identity.save(JWK);
    expect(await portsOf("browser").identity.load()).toEqual(JWK);
    expect(await portsOf("other").identity.load()).toBeUndefined();
    expect(local["collabIdentity.browser"]).toEqual(JWK);
  });

  it("reads a malformed identity, contacts and switch as absent", async () => {
    local["collabIdentity.browser"] = { encryption: "nope" };
    local["collabContacts.browser"] = [{ name: "x" }];
    local["collabInvitationsEnabled.browser"] = "yes";
    const ports = portsOf("browser");
    expect(await ports.identity.load()).toBeUndefined();
    expect(await ports.contacts.read()).toEqual([]);
    expect(await ports.enabled.get()).toBe(false);
  });

  it("keeps contacts and the switch, off until set", async () => {
    const ports = portsOf("browser");
    expect(await ports.enabled.get()).toBe(false);
    await ports.enabled.set(true);
    await ports.contacts.write([CONTACT]);
    expect(await portsOf("browser").enabled.get()).toBe(true);
    expect(await portsOf("browser").contacts.read()).toEqual([CONTACT]);
    expect(await portsOf("other").contacts.read()).toEqual([]);
  });

  it("keeps email pins per library under their own key, and reads a malformed record as absent", async () => {
    const pin = { email: "ada@example.com", fingerprint: "f", encryptionKey: "e", signingKey: "s", pinned: 1 };
    const ports = portsOf("browser");
    expect(await ports.emailPins!.read()).toEqual([]);
    await ports.emailPins!.write([pin]);
    expect(local["collabEmailPins.browser"]).toEqual([pin]);
    expect(await portsOf("browser").emailPins!.read()).toEqual([pin]);
    expect(await portsOf("other").emailPins!.read()).toEqual([]);
    local["collabEmailPins.browser"] = [{ email: "x" }];
    expect(await portsOf("browser").emailPins!.read()).toEqual([]);
  });

  it("never writes the shares record", async () => {
    const shares = { libraries: { browser: { abc: { key: "k", relays: [] } } }, displayName: "Ada" };
    local["collabShares"] = shares;
    const ports = portsOf("browser");
    await ports.identity.save(JWK);
    await ports.contacts.write([CONTACT]);
    await ports.enabled.set(true);
    expect(local["collabShares"]).toEqual(shares);
  });

  it("names the user by the Cloudflare access token, and throws without an account", async () => {
    expect(await portsOf("browser", account).accessToken()).toBe("cf-token");
    await expect(portsOf("browser").accessToken()).rejects.toThrow();
  });
});
