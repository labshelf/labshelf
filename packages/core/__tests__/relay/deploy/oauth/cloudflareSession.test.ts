/** Pins the token refresh: rotation stored before the access token is used, a refused refresh surfaced, one refresh at a time. */
import { CloudflareOAuthError, createCloudflareSession, createStoredLock, type SecretSlot } from "../../../../src/relay/index";
import { recordingLogger } from "../fakeCloudflare";
import { fakeClock, fakeOAuthServer, memorySlot } from "./fakeOAuthServer";

type Server = ReturnType<typeof fakeOAuthServer>;
type Clock = ReturnType<typeof fakeClock>;

/** Signs in on the fake server so its first refresh token is live, and stores those tokens as expired. */
function signedIn(server: Server, clock: Clock) {
  server.liveRefresh.add("refresh-0");
  return memorySlot(JSON.stringify({ accessToken: "access-0", refreshToken: "refresh-0", expiresAt: clock.now() - 1 }));
}

function session(server: Server, clock: Clock, tokens: SecretSlot, lockSlot = memorySlot()) {
  const logger = recordingLogger();
  return { logger, session: createCloudflareSession({ tokens, lock: createStoredLock(lockSlot, clock), fetch: server.fetch, logger, clock }) };
}

describe("createCloudflareSession", () => {
  it("uses a stored access token that has not expired without refreshing", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = memorySlot(JSON.stringify({ accessToken: "access-0", refreshToken: "refresh-0", expiresAt: clock.now() + 600_000 }));
    expect(await session(server, clock, tokens).session.accessToken()).toBe("access-0");
    expect(server.grants).toEqual([]);
  });

  it("refreshes an expired token and stores the rotated refresh token", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = signedIn(server, clock);
    const { session: s, logger } = session(server, clock, tokens);
    expect(await s.accessToken()).toBe("access-1");
    expect(JSON.parse(tokens.value ?? "")).toEqual({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: clock.now() + 3600_000 });
    expect(JSON.stringify(logger.calls)).not.toMatch(/access-1|refresh-[01]/);
  });

  it("does not hand out the access token when the rotated tokens cannot be stored", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = signedIn(server, clock);
    tokens.store = async () => { throw new Error("keychain locked"); };
    await expect(session(server, clock, tokens).session.accessToken()).rejects.toThrow("keychain locked");
  });

  it("surfaces a refused refresh token as invalid_grant", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = memorySlot(JSON.stringify({ accessToken: "access-0", refreshToken: "stale", expiresAt: clock.now() - 1 }));
    const { session: s, logger } = session(server, clock, tokens);
    const failure = await s.accessToken().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CloudflareOAuthError);
    expect(failure).toMatchObject({ code: "invalid_grant" });
    expect(logger.calls.length).toBeGreaterThan(0);
  });

  it("refuses with not_signed_in when no tokens are stored", async () => {
    await expect(session(fakeOAuthServer(), fakeClock(), memorySlot()).session.accessToken()).rejects.toMatchObject({ code: "not_signed_in" });
  });

  it("lets two windows sharing the store refresh once, both getting the rotated token", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = signedIn(server, clock);
    const lockSlot = memorySlot();
    const first = session(server, clock, tokens, lockSlot).session;
    const second = session(server, clock, tokens, lockSlot).session;
    expect(await Promise.all([first.accessToken(), second.accessToken()])).toEqual(["access-1", "access-1"]);
    expect(server.grants).toEqual(["refresh_token"]);
    expect(lockSlot.value).toBeUndefined();
  });

  it("takes over a lock a crashed window left behind", async () => {
    const server = fakeOAuthServer();
    const clock = fakeClock();
    const tokens = signedIn(server, clock);
    const lockSlot = memorySlot(JSON.stringify({ owner: "crashed", at: clock.now() }));
    expect(await session(server, clock, tokens, lockSlot).session.accessToken()).toBe("access-1");
    expect(lockSlot.value).toBeUndefined();
  });
});
