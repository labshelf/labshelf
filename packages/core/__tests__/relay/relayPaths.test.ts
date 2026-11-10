/** Pins the random relay Worker name kept in the account, and the Durable Object migrations an update sends by tag. */
import {
  connectRelayAccount, createWorkerName, RELAY_MIGRATIONS, removeRelayAccount, SHARE_MIGRATIONS, updateOwnRelay, updateRelayIfOlder, type RelayMigration,
} from "../../src/relay/index";
import { ACCOUNT, fakeCloudflare, metadataOf, recordingLogger, TOKEN } from "./fakeCloudflare";
import { accountWorld, connectedAccount, signIn } from "./fakeRelayAccount";

const NAME = /^ls-[a-z2-7]{12}$/;

// CONTRACT: documents/contracts/relay.md#deploy
describe("createWorkerName", () => {
  it("draws ls- and 12 lowercase base32 characters, different each time", () => {
    const names = Array.from({ length: 50 }, () => createWorkerName());
    for (const name of names) { expect(name).toMatch(NAME); }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the stored Worker name", () => {
  it("is drawn on connect, deployed and kept in the account", async () => {
    const world = accountWorld();
    const relayUrl = await connectRelayAccount({
      ...world.deps, chooseCredential: async () => ({ kind: "token", token: "access-1" }), chooseAccount: async () => ACCOUNT,
      offerToShares: async () => undefined, script: "export default {}", shareScript: "export default {}",
    });
    const account = await world.store.get();
    expect(account?.workerName).toMatch(NAME);
    expect(relayUrl).toBe(`https://${account?.workerName}.lab.workers.dev`);
    expect(world.scriptCalls).toContain(`PUT ${account?.workerName}`);
    // The other script is the separate share Worker, under its own random name.
    expect(new Set(world.scriptCalls.map((call) => call.split(" ")[1]))).toEqual(new Set([account?.workerName, account?.shareWorker.name]));
  });

  it("names the Worker that a disconnect deletes", async () => {
    const world = accountWorld();
    signIn(world);
    await world.store.save(connectedAccount);
    await removeRelayAccount({ ...world.deps, withdrawFromShares: async () => undefined });
    expect(world.scriptCalls).toEqual([`DELETE ${connectedAccount.workerName}`, `DELETE ${connectedAccount.shareWorker.name}`]);
  });

  it("names the Worker that an update uploads", async () => {
    const world = accountWorld({ relayVersion: { v: "2.0", worker: "0.0.1", migrationTag: "v1" } });
    signIn(world);
    await world.store.save(connectedAccount);
    expect(await updateOwnRelay({ ...world.deps, script: "export default {}", shareScript: "export default {}" })).toBe("updated");
    // The share Worker goes first, so the Mirror class the relay binds exists before the relay drops its own.
    expect(world.scriptCalls).toEqual([`PUT ${connectedAccount.shareWorker.name}`, `PUT ${connectedAccount.workerName}`]);
  });
});

const TWO_STEPS: RelayMigration[] = [
  { tag: "v1", new_sqlite_classes: ["Room"] },
  { tag: "v2", new_sqlite_classes: ["Invites"] },
];

// CONTRACT: documents/contracts/relay.md#versions
describe("migrations on update", () => {
  function relayOn(version: { worker: string; migrationTag?: string }) {
    const relayVersion: Record<string, unknown> = { v: "2.0", ...version };
    const cloudflare = fakeCloudflare({ hasSubdomain: true, relayVersion });
    const update = () => updateRelayIfOlder({
      relayUrl: "https://relay.lab.workers.dev", bundledVersion: "2.0.5", accessToken: async () => TOKEN, accountId: ACCOUNT,
      script: "// bundle", workerName: "relay", kvNamespaceId: "kv-1", shareWorkerName: "share", migrations: TWO_STEPS, logger: recordingLogger(), fetch: cloudflare.fetch,
    });
    const uploads = () => cloudflare.requests.filter((request) => request.method === "PUT" && request.path.endsWith("/workers/scripts/relay"));
    return { relayVersion, update, uploads };
  }

  it("sends the v2 step to a Worker on v1, once", async () => {
    const relay = relayOn({ worker: "2.0.1", migrationTag: "v1" });
    expect(await relay.update()).toBe("updated");
    // The Worker now runs the uploaded bundle, which reports the new build and tag.
    Object.assign(relay.relayVersion, { worker: "2.0.5", migrationTag: "v2" });
    expect(await relay.update()).toBe("current");
    const uploads = relay.uploads();
    expect(uploads).toHaveLength(1);
    expect((await metadataOf(uploads[0]!)).migrations).toEqual({ old_tag: "v1", new_tag: "v2", steps: [{ new_sqlite_classes: ["Invites"] }] });
  });

  it("sends no step to a Worker already on v2", async () => {
    const relay = relayOn({ worker: "2.0.1", migrationTag: "v2" });
    expect(await relay.update()).toBe("updated");
    const uploads = relay.uploads();
    expect(uploads).toHaveLength(1);
    expect(await metadataOf(uploads[0]!)).not.toHaveProperty("migrations");
  });

  it("refuses a tag it does not know instead of guessing the steps", async () => {
    const relay = relayOn({ worker: "2.0.1", migrationTag: "v9" });
    await expect(relay.update()).rejects.toThrow(/"v9"/);
    expect(relay.uploads()).toHaveLength(0);
  });

  it("starts the bundled list with the Room class", () => {
    expect(RELAY_MIGRATIONS[0]).toEqual({ tag: "v1", new_sqlite_classes: ["Room"] });
  });

  it("ends the relay's list by deleting Mirror, which the share Worker's own list creates", () => {
    expect(RELAY_MIGRATIONS.at(-1)).toEqual({ tag: "v4", deleted_classes: ["Mirror"] });
    expect(SHARE_MIGRATIONS).toEqual([{ tag: "v1", new_sqlite_classes: ["Mirror"] }]);
  });
});
