/** Pins the owner's account flows: connecting, the access token, disconnecting, the start-up update and the remote library's R2 bucket. */
import {
  bindMirrorBucket, connectRelayAccount, createAccessTokenReader, CloudflareOauthError, createRelayAccountStore, createStoredLock, removeRelayAccount,
  unbindMirrorBucket, updateOwnRelay, RELAY_WORKER_BUILD,
  type RelayCredential,
} from "../../src/relay/index";
import { ACCOUNT, metadataOf } from "./fakeCloudflare";
import { memorySlot } from "./fakeOAuthServer";
import { accountWorld, connectedAccount, routes, signIn, type World, type WorldOptions } from "./fakeRelayAccount";

const PASTED: RelayCredential = { kind: "token", token: "access-1" };
const CREATE_NAMESPACE = "POST /accounts/<A>/storage/kv/namespaces";
const RELAY_URL = /^https:\/\/ls-[a-z2-7]{12}\.lab\.workers\.dev$/;

function connecting(options: WorldOptions = {}, credential: () => Promise<RelayCredential | undefined> = async () => PASTED) {
  const world = accountWorld(options);
  const chooseCredential = jest.fn(credential);
  const chooseAccount = jest.fn(async (accounts: { id: string }[]) => accounts[0]?.id);
  const offerToShares = jest.fn(async () => undefined);
  const connect = () => connectRelayAccount({ ...world.deps, chooseCredential, chooseAccount, offerToShares, script: "export default {}", shareScript: "export default {}" });
  return { world, chooseCredential, chooseAccount, offerToShares, connect };
}

const deployed = (world: World) => routes(world).some((route) => route.startsWith("PUT /accounts/<A>/workers/scripts"));

describe("connectRelayAccount", () => {
  it("connects with a sign-in and offers the relay to the shares once", async () => {
    const run = connecting({}, async () => { signIn(run.world); return { kind: "oauth" }; });
    expect(await run.connect()).toMatch(RELAY_URL);
    // The share Worker is deployed first, so its namespace is the first one created.
    expect(await run.world.store.get()).toMatchObject({
      credential: { kind: "oauth" }, accountId: ACCOUNT, kvNamespaceId: "kv-2", shareWorker: { kvNamespaceId: "kv-1" },
    });
    expect(run.offerToShares).toHaveBeenCalledTimes(1);
    expect(run.world.slots.tokens.value).toBeDefined();
  });

  it("deploys the share Worker with Mirror first, then the relay bound to it by script name", async () => {
    const run = connecting();
    await run.connect();
    const account = (await run.world.store.get())!;
    expect(run.world.scriptCalls[0]).toBe(`PUT ${account.shareWorker.name}`);
    const share = await metadataOf({ method: "PUT", path: "", headers: {}, form: run.world.scripts.get(account.shareWorker.name)!.form });
    expect(share).toMatchObject({
      bindings: [
        { type: "durable_object_namespace", name: "MIRROR", class_name: "Mirror" },
        { type: "kv_namespace", name: "KV", namespace_id: "kv-1" },
      ],
      migrations: { new_tag: "v1", steps: [{ new_sqlite_classes: ["Mirror"] }] },
    });
    const relay = await metadataOf({ method: "PUT", path: "", headers: {}, form: run.world.scripts.get(account.workerName)!.form });
    expect(relay.bindings).toContainEqual({ type: "durable_object_namespace", name: "MIRROR", class_name: "Mirror", script_name: account.shareWorker.name });
  });

  it("picks the only account without asking", async () => {
    const run = connecting();
    await run.connect();
    expect(run.chooseAccount).not.toHaveBeenCalled();
  });

  it("keeps the account when the relay never answers, so it can be used or deleted", async () => {
    const run = connecting({ relayNeverAnswers: true });
    await expect(run.connect()).rejects.toThrow(/did not answer/);
    expect(await run.world.store.get()).toMatchObject({ accountId: ACCOUNT, relayUrl: expect.stringMatching(RELAY_URL) });
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
    expect(await run.connect()).toMatch(RELAY_URL);
    // One namespace for the relay and one for the share Worker, each created once.
    expect(routes(run.world).filter((route) => route === CREATE_NAMESPACE)).toHaveLength(2);
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

describe("createAccessTokenReader", () => {
  it("hands out a pasted API token without the OAuth server", async () => {
    const world = accountWorld();
    expect(await createAccessTokenReader(world.deps, { kind: "token", token: "tok-1" })()).toBe("tok-1");
    expect(world.oauth.grants).toEqual([]);
  });

  it("refreshes an expired access token and stores the rotated tokens before returning", async () => {
    const world = accountWorld();
    signIn(world, true);
    world.slots.tokens.store = async (value) => {
      world.slots.tokens.value = value;
      expect(world.oauth.grants).toEqual(["refresh_token"]);
    };
    expect(await createAccessTokenReader(world.deps, { kind: "oauth" })()).toBe("access-1");
    expect(JSON.parse(world.slots.tokens.value ?? "")).toMatchObject({ accessToken: "access-1", refreshToken: "refresh-1" });
  });

  it("refreshes once when two windows sharing the store ask with an expired token", async () => {
    const world = accountWorld();
    signIn(world, true);
    const lockSlot = memorySlot();
    const window = () => ({
      ...world.deps,
      store: createRelayAccountStore({ account: world.slots.account, tokens: world.slots.tokens, refreshLock: createStoredLock(lockSlot, world.clock) }, world.logger),
    });
    const tokens = await Promise.all([createAccessTokenReader(window(), { kind: "oauth" })(), createAccessTokenReader(window(), { kind: "oauth" })()]);
    expect(tokens).toEqual(["access-1", "access-1"]);
    expect(world.oauth.grants).toEqual(["refresh_token"]);
  });

  it("rethrows a refused refresh when the owner declines to sign in again", async () => {
    const world = accountWorld();
    world.slots.tokens.value = JSON.stringify({ accessToken: "a", refreshToken: "stale", expiresAt: world.clock.now() - 1 });
    const failure = await createAccessTokenReader(world.deps, { kind: "oauth" })().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CloudflareOauthError);
    expect(failure).toMatchObject({ code: "invalid_grant" });
    expect(world.signInAgain).toHaveBeenCalledWith(failure);
  });

  it("returns the token of a new sign-in when the owner signs in again", async () => {
    const world = accountWorld();
    world.slots.tokens.value = JSON.stringify({ accessToken: "a", refreshToken: "stale", expiresAt: world.clock.now() - 1 });
    world.signInAgain.mockImplementation(async () => {
      world.slots.tokens.value = JSON.stringify({ accessToken: "access-9", refreshToken: "refresh-9", expiresAt: world.clock.now() + 3_600_000 });
      return true;
    });
    expect(await createAccessTokenReader(world.deps, { kind: "oauth" })()).toBe("access-9");
  });

  it("asks to sign in again when no sign-in is stored", async () => {
    const world = accountWorld();
    await expect(createAccessTokenReader(world.deps, { kind: "oauth" })()).rejects.toMatchObject({ code: "not_signed_in" });
    expect(world.signInAgain).toHaveBeenCalledTimes(1);
  });

  it("does not ask to sign in again for other failures", async () => {
    const world = accountWorld();
    world.slots.tokens.value = JSON.stringify({ accessToken: "a", refreshToken: "r", expiresAt: world.clock.now() - 1 });
    const deps = { ...world.deps, fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch };
    await expect(createAccessTokenReader(deps, { kind: "oauth" })()).rejects.toThrow();
    expect(world.signInAgain).not.toHaveBeenCalled();
  });
});

async function connected(options: WorldOptions = {}) {
  const world = accountWorld(options);
  signIn(world);
  await world.store.save(connectedAccount);
  const deletesWhenWithdrawn: string[][] = [];
  const withdrawFromShares = jest.fn(async () => { deletesWhenWithdrawn.push(routes(world).filter((route) => route.startsWith("DELETE"))); });
  const disconnect = () => removeRelayAccount({ ...world.deps, withdrawFromShares });
  return { world, withdrawFromShares, deletesWhenWithdrawn, disconnect };
}

describe("removeRelayAccount", () => {
  it("withdraws the relay from the shares before deleting it, then forgets the account", async () => {
    const run = await connected();
    expect(await run.disconnect()).toEqual({ accountId: connectedAccount.accountId, relayUrl: connectedAccount.relayUrl });
    expect(run.withdrawFromShares).toHaveBeenCalledWith(connectedAccount.relayUrl);
    expect(run.deletesWhenWithdrawn).toEqual([[]]);
    expect(routes(run.world).some((route) => route.startsWith("DELETE"))).toBe(true);
    expect(await run.world.store.get()).toBeUndefined();
    expect(run.world.slots.tokens.value).toBeUndefined();
  });

  it("keeps the account when the deletion fails, so it can be retried", async () => {
    const run = await connected({ failDeletes: true });
    await expect(run.disconnect()).rejects.toThrow();
    expect(await run.world.store.get()).toEqual(connectedAccount);
  });

  it("leaves the shares when the owner declines to sign in again", async () => {
    const run = await connected();
    run.world.slots.tokens.value = undefined;
    await expect(run.disconnect()).rejects.toMatchObject({ code: "not_signed_in" });
    expect(run.withdrawFromShares).not.toHaveBeenCalled();
    expect(await run.world.store.get()).toEqual(connectedAccount);
  });

  it("does nothing when no account is connected", async () => {
    const world = accountWorld();
    const withdrawFromShares = jest.fn(async () => undefined);
    expect(await removeRelayAccount({ ...world.deps, withdrawFromShares })).toBeUndefined();
    expect(withdrawFromShares).not.toHaveBeenCalled();
    expect(world.cloudflare.requests).toEqual([]);
  });
});

describe("updateOwnRelay", () => {
  it("does nothing without a connected account", async () => {
    const world = accountWorld();
    expect(await updateOwnRelay({ ...world.deps, script: "export default {}" })).toBeUndefined();
    expect(world.cloudflare.requests).toEqual([]);
  });

  it("reports the outcome for the connected relay", async () => {
    const run = await connected({ relayVersion: { v: "1.0", worker: "999.0.0" } });
    expect(await updateOwnRelay({ ...run.world.deps, script: "export default {}", shareScript: "export default {}" })).toBe("deployedNewer");
  });

  it("updates the share Worker first, giving one whose /version reads 404 every step, then the relay bound to it", async () => {
    const run = await connected({ relayVersion: { v: "2.2", worker: "2.2.0", migrationTag: "v3" }, shareVersion: 404 });
    expect(await updateOwnRelay({ ...run.world.deps, script: "relay()", shareScript: "share()" })).toBe("updated");
    const versionReads = run.world.cloudflare.requests.filter((request) => request.path.endsWith("/version")).map((request) => request.path);
    expect(versionReads).toEqual([`${connectedAccount.shareWorker.url}/version`, `${connectedAccount.relayUrl}/version`]);
    expect(run.world.scriptCalls).toEqual([`PUT ${connectedAccount.shareWorker.name}`, `PUT ${connectedAccount.workerName}`]);
    const share = await metadataOf({ method: "PUT", path: "", headers: {}, form: run.world.scripts.get(connectedAccount.shareWorker.name)!.form });
    expect(share.migrations).toEqual({ new_tag: "v1", steps: [{ new_sqlite_classes: ["Mirror"] }] });
    const relay = await metadataOf({ method: "PUT", path: "", headers: {}, form: run.world.scripts.get(connectedAccount.workerName)!.form });
    expect(relay.migrations).toEqual({ old_tag: "v3", new_tag: "v4", steps: [{ deleted_classes: ["Mirror"] }] });
    expect(relay.bindings).toContainEqual({
      type: "durable_object_namespace", name: "MIRROR", class_name: "Mirror", script_name: connectedAccount.shareWorker.name,
    });
  });

  it("leaves a current share Worker alone", async () => {
    const current = { v: "2.3", worker: RELAY_WORKER_BUILD, migrationTag: "v1" };
    const run = await connected({ relayVersion: { v: "2.3", worker: RELAY_WORKER_BUILD, migrationTag: "v4" }, shareVersion: current });
    expect(await updateOwnRelay({ ...run.world.deps, script: "relay()", shareScript: "share()" })).toBe("current");
    expect(run.world.scriptCalls).toEqual([]);
  });
});

describe("bindMirrorBucket", () => {
  const current = { v: "2.3", worker: RELAY_WORKER_BUILD, migrationTag: "v1" };

  it("uploads the share Worker with the R2 binding and stores the bucket, which later uploads send again", async () => {
    const run = await connected({ shareVersion: current });
    await bindMirrorBucket({ ...run.world.deps, shareScript: "share()" });
    const share = await metadataOf({ method: "PUT", path: "", headers: {}, form: run.world.scripts.get(connectedAccount.shareWorker.name)!.form });
    expect(share.bindings).toContainEqual({ type: "r2_bucket", name: "MIRROR_BUCKET", bucket_name: "labshelf-mirror" });
    expect(share).not.toHaveProperty("migrations");
    expect((await run.world.store.get())?.shareWorker.r2Bucket).toBe("labshelf-mirror");
    run.world.cloudflareOptions.shareVersion = { ...current, worker: "0.0.1" };
    await updateOwnRelay({ ...run.world.deps, script: "relay()", shareScript: "share()" });
    const updated = await metadataOf({ method: "PUT", path: "", headers: {}, form: run.world.scripts.get(connectedAccount.shareWorker.name)!.form });
    expect(updated.bindings).toContainEqual({ type: "r2_bucket", name: "MIRROR_BUCKET", bucket_name: "labshelf-mirror" });
  });

  it("asks the owner to create the bucket when Cloudflare refuses the binding", async () => {
    const run = await connected({ shareVersion: current, failScriptUploadWith: { status: 400, code: 10085, message: "R2 bucket 'labshelf-mirror' not found" } });
    await expect(bindMirrorBucket({ ...run.world.deps, shareScript: "share()" }))
      .rejects.toThrow("Create the R2 bucket labshelf-mirror first (R2 needs a card on your Cloudflare account).");
    expect((await run.world.store.get())?.shareWorker.r2Bucket).toBeUndefined();
  });

  it("unbinds: uploads without the binding and forgets the bucket", async () => {
    const run = await connected({ shareVersion: current });
    await bindMirrorBucket({ ...run.world.deps, shareScript: "share()" });
    await unbindMirrorBucket({ ...run.world.deps, shareScript: "share()" });
    const share = await metadataOf({ method: "PUT", path: "", headers: {}, form: run.world.scripts.get(connectedAccount.shareWorker.name)!.form });
    expect(share.bindings).not.toContainEqual(expect.objectContaining({ type: "r2_bucket" }));
    expect((await run.world.store.get())?.shareWorker).toEqual(connectedAccount.shareWorker);
  });
});
