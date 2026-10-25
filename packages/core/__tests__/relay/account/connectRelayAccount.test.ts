/** Pins connecting an account: saved before the serving wait, sign-in tokens forgotten when no connection results, and the choices it asks. */
import { connectRelayAccount, type RelayCredential } from "../../../src/relay/index";
import { ACCOUNT } from "../client/fakeCloudflare";
import { accountWorld, routes, signIn, type World, type WorldOptions } from "./fakeRelayAccount";

const PASTED: RelayCredential = { kind: "token", token: "access-1" };
const CREATE_NAMESPACE = "POST /accounts/<A>/storage/kv/namespaces";

function connecting(options: WorldOptions = {}, credential: () => Promise<RelayCredential | undefined> = async () => PASTED) {
  const world = accountWorld(options);
  const chooseCredential = jest.fn(credential);
  const chooseAccount = jest.fn(async (accounts: { id: string }[]) => accounts[0]?.id);
  const offerToShares = jest.fn(async () => undefined);
  const connect = () => connectRelayAccount({ ...world.deps, chooseCredential, chooseAccount, offerToShares, script: "export default {}" });
  return { world, chooseCredential, chooseAccount, offerToShares, connect };
}

const deployed = (world: World) => routes(world).some((route) => route.startsWith("PUT /accounts/<A>/workers/scripts"));

describe("connectRelayAccount", () => {
  it("connects with a sign-in and offers the relay to the shares once", async () => {
    const run = connecting({}, async () => { signIn(run.world); return { kind: "oauth" }; });
    expect(await run.connect()).toBe("https://labshelf-relay.lab.workers.dev");
    expect(await run.world.store.get()).toMatchObject({ credential: { kind: "oauth" }, accountId: ACCOUNT, kvNamespaceId: "kv-1" });
    expect(run.offerToShares).toHaveBeenCalledTimes(1);
    expect(run.world.slots.tokens.value).toBeDefined();
  });

  it("picks the only account without asking", async () => {
    const run = connecting();
    await run.connect();
    expect(run.chooseAccount).not.toHaveBeenCalled();
  });

  it("keeps the account when the relay never answers, so it can be used or deleted", async () => {
    const run = connecting({ relayNeverAnswers: true });
    await expect(run.connect()).rejects.toThrow(/did not answer/);
    expect(await run.world.store.get()).toMatchObject({ accountId: ACCOUNT, relayUrl: "https://labshelf-relay.lab.workers.dev" });
    expect(run.offerToShares).not.toHaveBeenCalled();
  });

  it("stores no account and forgets the sign-in when the deploy fails", async () => {
    const run = connecting({ failScriptUploadWith: { status: 403, code: 10000, message: "Authentication error" } },
      async () => { signIn(run.world); return { kind: "oauth" }; });
    await expect(run.connect()).rejects.toThrow();
    expect(await run.world.store.get()).toBeUndefined();
    expect(run.world.slots.tokens.value).toBeUndefined();
  });

  it("reuses the KV namespace a failed deploy left when retried", async () => {
    const run = connecting({ failScriptUploadWith: { status: 403, code: 10000, message: "Authentication error" } });
    await expect(run.connect()).rejects.toThrow();
    delete run.world.cloudflareOptions.failScriptUploadWith;
    expect(await run.connect()).toBe("https://labshelf-relay.lab.workers.dev");
    expect(routes(run.world).filter((route) => route === CREATE_NAMESPACE)).toHaveLength(1);
  });

  it("forgets the sign-in and deploys nothing when the owner cancels after signing in", async () => {
    const run = connecting({}, async () => { signIn(run.world); return undefined; });
    expect(await run.connect()).toBeUndefined();
    expect(run.world.slots.tokens.value).toBeUndefined();
    expect(run.world.cloudflare.requests).toEqual([]);
  });

  it("forgets the sign-in and deploys nothing when the owner picks no account", async () => {
    const run = connecting({ accounts: [{ id: ACCOUNT, name: "Lab" }, { id: "other", name: "Other" }] },
      async () => { signIn(run.world); return { kind: "oauth" }; });
    run.chooseAccount.mockImplementation(async () => undefined);
    expect(await run.connect()).toBeUndefined();
    expect(run.chooseAccount).toHaveBeenCalledWith([{ id: ACCOUNT, name: "Lab" }, { id: "other", name: "Other" }]);
    expect(deployed(run.world)).toBe(false);
    expect(run.world.slots.tokens.value).toBeUndefined();
  });

  it("throws when the credential reaches no account", async () => {
    const run = connecting({ accounts: [] });
    await expect(run.connect()).rejects.toThrow(/reaches no Cloudflare account/);
    expect(deployed(run.world)).toBe(false);
  });
});
