/** Pins the stored relay account: the JSON both apps keep, a corrupt entry ignored without logging secrets, and forgetting. */
import { parseRelayAccount } from "../../../src/relay/index";
import { accountWorld, connectedAccount } from "./fakeRelayAccount";

// CONTRACT: documents/contracts/relay.md#owner-account
const STORED = '{"credential":{"kind":"token","token":"tok-SECRET"},"accountId":"acc-1","relayUrl":"https://labshelf-relay.lab.workers.dev",'
  + '"ownerSecret":"owner-SECRET","kvNamespaceId":"kv-1"}';

describe("parseRelayAccount", () => {
  it("reads the stored account JSON", () => {
    expect(parseRelayAccount(STORED)).toEqual({
      credential: { kind: "token", token: "tok-SECRET" }, accountId: "acc-1", relayUrl: "https://labshelf-relay.lab.workers.dev",
      ownerSecret: "owner-SECRET", kvNamespaceId: "kv-1",
    });
  });

  it.each([
    ["text that is not JSON", "{not json"],
    ["a missing field", '{"credential":{"kind":"oauth"},"accountId":"a","relayUrl":"u","ownerSecret":"s"}'],
    ["a token credential without its token", '{"credential":{"kind":"token"},"accountId":"a","relayUrl":"u","ownerSecret":"s","kvNamespaceId":"k"}'],
    ["an unknown credential", '{"credential":{"kind":"password"},"accountId":"a","relayUrl":"u","ownerSecret":"s","kvNamespaceId":"k"}'],
    ["a non-object", "null"],
  ])("refuses %s", (_name, text) => {
    expect(parseRelayAccount(text)).toBeUndefined();
  });
});

describe("createRelayAccountStore", () => {
  it("saves the account as the JSON it reads back", async () => {
    const world = accountWorld();
    await world.store.save(connectedAccount);
    expect(world.slots.account.value).toBe(JSON.stringify(connectedAccount));
    expect(await world.store.get()).toEqual(connectedAccount);
    world.slots.account.value = STORED;
    expect((await world.store.get())?.credential).toEqual({ kind: "token", token: "tok-SECRET" });
  });

  it("ignores a corrupt stored account and logs a warning without its text", async () => {
    const world = accountWorld();
    world.slots.account.value = '{"credential":{"kind":"token","token":"tok-SECRET"},"ownerSecret":"owner-SECRET"}';
    expect(await world.store.get()).toBeUndefined();
    expect(world.logger.calls.some((call) => call[0] === "WARN")).toBe(true);
    expect(JSON.stringify(world.logger.calls)).not.toMatch(/SECRET/);
  });

  it("is not connected when nothing is stored", async () => {
    const world = accountWorld();
    expect(await world.store.get()).toBeUndefined();
    expect(await world.store.status()).toBeUndefined();
    expect(world.logger.calls).toEqual([]);
  });

  it("reports only the relay address as status", async () => {
    const world = accountWorld();
    await world.store.save(connectedAccount);
    expect(await world.store.status()).toEqual({ relayUrl: connectedAccount.relayUrl });
  });

  it("forgets the account with the sign-in tokens", async () => {
    const world = accountWorld();
    await world.store.save(connectedAccount);
    world.slots.tokens.value = "{}";
    await world.store.forget();
    expect(world.slots.account.value).toBeUndefined();
    expect(world.slots.tokens.value).toBeUndefined();
  });
});
