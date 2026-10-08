import { exchangeCode, refreshTokens, revokeToken, ReauthRequiredError, type OAuthClient, type TokenData } from "../../../src/index";
import { fakeFetch, tokenResponse } from "../../support/oauthHarness";

const CLIENT: OAuthClient = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const TOKENS: TokenData = { access_token: "access-old", refresh_token: "refresh-1", expiry_ms: 1 };
const HINT = "Run the sign-in command.";

describe("exchangeCode", () => {
  it("posts the authorization-code grant with the PKCE verifier and returns the granted tokens", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse({ refresh_token: "refresh-from-login" }));
    const before = Date.now();

    const granted = await exchangeCode(fn, CLIENT, { code: "abc", verifier: "ver", redirectUri: "http://127.0.0.1:1234" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]!.method).toBe("POST");
    expect(Object.fromEntries(calls[0]!.body)).toEqual({
      grant_type: "authorization_code", code: "abc", redirect_uri: "http://127.0.0.1:1234", code_verifier: "ver",
      client_id: CLIENT.clientId, client_secret: "csecret",
    });
    expect(granted).toMatchObject({ access_token: "access-new", refresh_token: "refresh-from-login" });
    expect(granted.expiry_ms).toBeGreaterThanOrEqual(before + 3_600_000);
  });

  it("returns an undefined refresh token when Google sends none", async () => {
    const granted = await exchangeCode(fakeFetch(() => tokenResponse()).fn, CLIENT, { code: "c", verifier: "v", redirectUri: "r" });
    expect(granted.refresh_token).toBeUndefined();
  });

  it("fails with the HTTP status and the start of Google's answer, and never maps invalid_grant to a re-login", async () => {
    const { fn } = fakeFetch(() => new Response('{"error":"invalid_grant"}', { status: 400 }));
    const error = await exchangeCode(fn, CLIENT, { code: "c", verifier: "v", redirectUri: "r" }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ReauthRequiredError);
    expect((error as Error).message).toContain("Google token request failed: HTTP 400");
  });
});

describe("refreshTokens", () => {
  it("sends the refresh grant, keeps the old refresh token and computes a new expiry", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse({ access_token: "access-refreshed" }));
    const before = Date.now();

    const renewed = await refreshTokens(fn, CLIENT, TOKENS, HINT);

    expect(Object.fromEntries(calls[0]!.body)).toEqual({
      grant_type: "refresh_token", refresh_token: "refresh-1", client_id: CLIENT.clientId, client_secret: "csecret",
    });
    expect(renewed).toMatchObject({ access_token: "access-refreshed", refresh_token: "refresh-1" });
    expect(renewed.expiry_ms).toBeGreaterThanOrEqual(before + 3_600_000);
  });

  it("takes a rotated refresh token when Google sends one", async () => {
    const renewed = await refreshTokens(fakeFetch(() => tokenResponse({ refresh_token: "rotated" })).fn, CLIENT, TOKENS, HINT);
    expect(renewed.refresh_token).toBe("rotated");
  });

  it("omits client_secret for a client without one", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse());
    await refreshTokens(fn, { clientId: "cid", clientSecret: "" }, TOKENS, HINT);
    expect(calls[0]!.body.has("client_secret")).toBe(false);
    expect(calls[0]!.body.get("client_id")).toBe("cid");
  });

  it.each([400, 401])("maps invalid_grant (HTTP %i) to ReauthRequiredError carrying the sign-in hint", async (status) => {
    const { fn } = fakeFetch(() => new Response('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}', { status }));
    const error = await refreshTokens(fn, CLIENT, TOKENS, HINT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReauthRequiredError);
    expect((error as Error).message).toContain(HINT);
  });

  it.each([
    [400, '{"error":"invalid_request"}'],
    [500, "internal error"],
    [403, '{"error":"access_denied"}'],
    [500, '{"error":"invalid_grant"}'],
  ])("passes other failures through (HTTP %i)", async (status, body) => {
    const error = await refreshTokens(fakeFetch(() => new Response(body, { status })).fn, CLIENT, TOKENS, HINT).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ReauthRequiredError);
    expect((error as Error).message).toContain(`Google token request failed: HTTP ${status}`);
  });
});

describe("revokeToken", () => {
  it("posts the escaped token to the revoke endpoint", async () => {
    const { fn, calls } = fakeFetch(() => new Response("", { status: 200 }));
    await revokeToken(fn, "refresh/with+chars");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent("refresh/with+chars")}`);
  });

  it("throws when Google answers with an error status or cannot be reached", async () => {
    await expect(revokeToken(fakeFetch(() => new Response("", { status: 400 })).fn, "t")).rejects.toThrow("HTTP 400");
    await expect(revokeToken((async () => { throw new Error("offline"); }) as typeof fetch, "t")).rejects.toThrow("offline");
  });
});
