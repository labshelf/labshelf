/** Pins token verification, account listing and the readable errors of the Cloudflare client. */
import { CloudflareApiError, createCloudflareClient, listCloudflareAccounts, verifyCloudflareToken } from "../../../src/relay/index";
import { ACCOUNT, TOKEN, fakeCloudflare, recordingLogger } from "./fakeCloudflare";

const clientFor = (token: string, options: Parameters<typeof fakeCloudflare>[0] = {}) => {
  const cloudflare = fakeCloudflare(options);
  const logger = recordingLogger();
  return { client: createCloudflareClient({ token, fetch: cloudflare.fetch, logger }), logger, ...cloudflare };
};

describe("Cloudflare token and accounts", () => {
  it("accepts an active token and lists its accounts", async () => {
    const { client } = clientFor(TOKEN);
    await expect(verifyCloudflareToken(client)).resolves.toBeUndefined();
    await expect(listCloudflareAccounts(client)).resolves.toEqual([{ id: ACCOUNT, name: "Lab" }]);
  });

  it("accepts an account-owned token whose user endpoint is refused but whose accounts list", async () => {
    const { client } = clientFor(TOKEN, { accountOwnedToken: true });
    await expect(verifyCloudflareToken(client)).resolves.toBeUndefined();
  });

  it("turns a bad token into a readable typed error without logging the token", async () => {
    const { client, logger } = clientFor("wrong-token-xyz", { validToken: TOKEN });
    const error = await verifyCloudflareToken(client).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect(error).toMatchObject({ status: 401, code: 1000, cloudflareMessage: "Invalid API Token" });
    expect((error as Error).message).toMatch(/rejected the API token.*paste it whole/);
    expect(JSON.stringify(logger.calls)).not.toContain("wrong-token-xyz");
  });

  it("reports an expired token as rejected", async () => {
    const fetchStub = (async () => new Response(JSON.stringify({ success: true, result: { status: "expired" } }), { status: 200 })) as typeof fetch;
    const client = createCloudflareClient({ token: TOKEN, fetch: fetchStub, logger: recordingLogger() });
    await expect(verifyCloudflareToken(client)).rejects.toThrow(/the token is expired/);
  });

  it("reports a network failure with status 0", async () => {
    const fetchStub = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const client = createCloudflareClient({ token: TOKEN, fetch: fetchStub, logger: recordingLogger() });
    await expect(client.call("GET", "/accounts")).rejects.toMatchObject({ status: 0, message: expect.stringContaining("Could not reach Cloudflare") });
  });

  it("reports a non-JSON error body", async () => {
    const fetchStub = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as typeof fetch;
    const client = createCloudflareClient({ token: TOKEN, fetch: fetchStub, logger: recordingLogger() });
    await expect(client.call("GET", "/accounts")).rejects.toMatchObject({ status: 502, message: expect.stringContaining("bad gateway") });
  });

  it("treats a JSON array body like any other non-object: it is the result, and on failure only the status is read", async () => {
    const okStub = (async () => new Response("[]", { status: 200 })) as typeof fetch;
    const okClient = createCloudflareClient({ token: TOKEN, fetch: okStub, logger: recordingLogger() });
    await expect(okClient.call("GET", "/accounts")).resolves.toEqual([]);
    const failStub = (async () => new Response('[{"code":1000,"message":"x"}]', { status: 502 })) as typeof fetch;
    const failClient = createCloudflareClient({ token: TOKEN, fetch: failStub, logger: recordingLogger() });
    await expect(failClient.call("GET", "/accounts")).rejects.toMatchObject({ status: 502, code: 0 });
  });
});
