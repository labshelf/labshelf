/** Pins the sign-in request (PKCE S256, state, scopes, exact redirect), the callback check and the code exchange. */
import { createHash } from "node:crypto";

import {
  CloudflareOauthError, fetchCloudflareTokens, readAuthorizationCode, startCloudflareAuthorization,
} from "../../../src/relay/index";
import { recordingLogger, TOKEN } from "../client/fakeCloudflare";
import { CLIENT_ID, fakeOAuthServer, REDIRECT } from "./fakeOAuthServer";

const NOW = 5_000_000;
const exchange = (server: ReturnType<typeof fakeOAuthServer>, code: string, verifier: string, logger = recordingLogger()) =>
  fetchCloudflareTokens({ code, verifier, fetch: server.fetch, logger, now: () => NOW });

describe("startCloudflareAuthorization", () => {
  it("asks for the relay scopes with an S256 challenge of the verifier and a fresh state", async () => {
    const first = await startCloudflareAuthorization();
    const second = await startCloudflareAuthorization();
    const url = new URL(first.url);
    const params = url.searchParams;
    expect(`${url.origin}${url.pathname}`).toBe("https://dash.cloudflare.com/oauth2/auth");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("scope")).toBe("workers-scripts.admin workers-kv-storage.write account-settings.read offline_access");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBe(createHash("sha256").update(first.verifier).digest("base64url"));
    expect(params.get("state")).toBe(first.state);
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(second.state).not.toBe(first.state);
    expect(second.verifier).not.toBe(first.verifier);
  });
});

describe("readAuthorizationCode", () => {
  it("returns the code of a callback whose state matches", async () => {
    const server = fakeOAuthServer();
    const { url, state } = await startCloudflareAuthorization();
    expect(readAuthorizationCode(server.approve(url), state)).toBe("code-1");
  });

  it("refuses a callback with another state", async () => {
    const server = fakeOAuthServer();
    const { url, state } = await startCloudflareAuthorization();
    const callback = server.approve(url, { state: "forged" });
    expect(() => readAuthorizationCode(callback, state)).toThrow(expect.objectContaining({ code: "state_mismatch" }) as Error);
  });

  it("surfaces the error the consent screen returned", async () => {
    const server = fakeOAuthServer();
    const { url, state } = await startCloudflareAuthorization();
    const callback = server.approve(url, { error: "access_denied" });
    expect(() => readAuthorizationCode(callback, state)).toThrow(CloudflareOauthError);
    expect(() => readAuthorizationCode(callback, state)).toThrow(expect.objectContaining({ code: "access_denied" }) as Error);
  });
});

describe("fetchCloudflareTokens", () => {
  it("trades the code and the verifier for tokens that expire after expires_in", async () => {
    const server = fakeOAuthServer();
    const { url, state, verifier } = await startCloudflareAuthorization();
    const logger = recordingLogger();
    const tokens = await exchange(server, readAuthorizationCode(server.approve(url), state), verifier, logger);
    expect(tokens).toEqual({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: NOW + 3600_000 });
    expect(JSON.stringify(logger.calls)).not.toMatch(/access-1|refresh-1|code-1/);
  });

  it("is refused with a verifier that does not match the challenge", async () => {
    const server = fakeOAuthServer();
    const { url, state } = await startCloudflareAuthorization();
    const code = readAuthorizationCode(server.approve(url), state);
    await expect(exchange(server, code, TOKEN)).rejects.toMatchObject({ name: "CloudflareOauthError", code: "invalid_grant" });
  });
});
