// The browser's relay account store: IndexedDB slots shared by every extension page, behind a Web Lock.
import "fake-indexeddb/auto";
import type { ILogger, RelayAccount } from "@labshelf/core";
import { installFakeLocks } from "../support/fakeLocks";
import { openBrowserRelayAccountStore } from "../../src/relay";
import { createRelayAccountSlot } from "../../src/relay/browserRelayAccountStore";

const logger: ILogger = { log: async () => undefined, error: async () => undefined };
const account: RelayAccount = {
  accountId: "acc", relayUrl: "https://labshelf-relay.example.workers.dev", ownerSecret: "secret", kvNamespaceId: "kv",
  credential: { kind: "oauth" },
} as RelayAccount;

beforeAll(() => { installFakeLocks(); });
afterEach(async () => { await openBrowserRelayAccountStore(logger).forget(); });

it("reads back the saved account", async () => {
  const store = openBrowserRelayAccountStore(logger);
  await store.save(account);
  expect(await store.get()).toEqual(account);
});

it("ignores account text that does not parse", async () => {
  const store = openBrowserRelayAccountStore(logger);
  await store.save(account);
  await createRelayAccountSlot("account").store("{");
  expect(await store.get()).toBeUndefined();
});

it("forgets the account and the tokens", async () => {
  const store = openBrowserRelayAccountStore(logger);
  await store.save(account);
  await store.tokens.store("{\"accessToken\":\"at\"}");
  await store.forget();
  expect(await store.get()).toBeUndefined();
  expect(await store.tokens.get()).toBeUndefined();
});

it("shares the data between two pages' stores", async () => {
  await openBrowserRelayAccountStore(logger).save(account);
  await openBrowserRelayAccountStore(logger).tokens.store("t");
  const other = openBrowserRelayAccountStore(logger);
  expect(await other.get()).toEqual(account);
  expect(await other.tokens.get()).toBe("t");
});

it("runs refreshes one at a time", async () => {
  const store = openBrowserRelayAccountStore(logger);
  const order: string[] = [];
  let release!: () => void;
  const first = store.refreshLock.run(async () => { order.push("a"); await new Promise<void>((r) => { release = r; }); order.push("a done"); });
  const second = openBrowserRelayAccountStore(logger).refreshLock.run(async () => { order.push("b"); });
  await new Promise((r) => setTimeout(r, 0));
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(["a", "a done", "b"]);
});
