/** Pins the account's access token: a pasted token as is, a refresh stored before use, one refresh across windows, and sign-in again. */
import { accountAccessToken, CloudflareOAuthError, createRelayAccountStore, createStoredLock } from "../../../src/relay/index";
import { memorySlot } from "../oauth/fakeOAuthServer";
import { accountWorld, signIn } from "./fakeRelayAccount";

describe("accountAccessToken", () => {
  it("hands out a pasted API token without the OAuth server", async () => {
    const world = accountWorld();
    expect(await accountAccessToken(world.deps, { kind: "token", token: "tok-1" })()).toBe("tok-1");
    expect(world.oauth.grants).toEqual([]);
  });

  it("refreshes an expired access token and stores the rotated tokens before returning", async () => {
    const world = accountWorld();
    signIn(world, true);
    world.slots.tokens.store = async (value) => {
      world.slots.tokens.value = value;
      expect(world.oauth.grants).toEqual(["refresh_token"]);
    };
    expect(await accountAccessToken(world.deps, { kind: "oauth" })()).toBe("access-1");
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
    const tokens = await Promise.all([accountAccessToken(window(), { kind: "oauth" })(), accountAccessToken(window(), { kind: "oauth" })()]);
    expect(tokens).toEqual(["access-1", "access-1"]);
    expect(world.oauth.grants).toEqual(["refresh_token"]);
  });

  it("rethrows a refused refresh when the owner declines to sign in again", async () => {
    const world = accountWorld();
    world.slots.tokens.value = JSON.stringify({ accessToken: "a", refreshToken: "stale", expiresAt: world.clock.now() - 1 });
    const failure = await accountAccessToken(world.deps, { kind: "oauth" })().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CloudflareOAuthError);
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
    expect(await accountAccessToken(world.deps, { kind: "oauth" })()).toBe("access-9");
  });

  it("asks to sign in again when no sign-in is stored", async () => {
    const world = accountWorld();
    await expect(accountAccessToken(world.deps, { kind: "oauth" })()).rejects.toMatchObject({ code: "not_signed_in" });
    expect(world.signInAgain).toHaveBeenCalledTimes(1);
  });

  it("does not ask to sign in again for other failures", async () => {
    const world = accountWorld();
    world.slots.tokens.value = JSON.stringify({ accessToken: "a", refreshToken: "r", expiresAt: world.clock.now() - 1 });
    const deps = { ...world.deps, fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch };
    await expect(accountAccessToken(deps, { kind: "oauth" })()).rejects.toThrow();
    expect(world.signInAgain).not.toHaveBeenCalled();
  });
});
