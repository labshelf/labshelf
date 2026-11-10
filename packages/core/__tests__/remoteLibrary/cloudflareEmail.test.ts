/** Pins readCloudflareEmail: it reads the account email from GET /client/v4/user, answers undefined without user-details access and throws on a server failure. */
import { readCloudflareEmail } from "../../src/remoteLibrary/cloudflareEmail";

function fetchAnswering(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const doFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { doFetch, calls };
}

describe("readCloudflareEmail", () => {
  it("reads the email from /user with a bearer header", async () => {
    const { doFetch, calls } = fetchAnswering(200, { success: true, result: { email: "owner@lab.org" } });
    expect(await readCloudflareEmail("tok-1", doFetch)).toBe("owner@lab.org");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/user");
    expect(calls[0]?.init?.headers).toEqual({ authorization: "Bearer tok-1" });
  });

  it("answers undefined when the token has no user-details access", async () => {
    const { doFetch } = fetchAnswering(403, { success: false, errors: [] });
    expect(await readCloudflareEmail("tok-1", doFetch)).toBeUndefined();
  });

  it("answers undefined when the result has no email", async () => {
    const { doFetch } = fetchAnswering(200, { success: true, result: {} });
    expect(await readCloudflareEmail("tok-1", doFetch)).toBeUndefined();
  });

  it("rejects on a server failure", async () => {
    const { doFetch } = fetchAnswering(500, { success: false });
    await expect(readCloudflareEmail("tok-1", doFetch)).rejects.toThrow();
  });
});
