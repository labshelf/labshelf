// Verifies device authorization scopes, polling, refusal and cancellation without a client secret.
import { startGitHubDeviceSignIn, finishGitHubDeviceSignIn } from "../../../src/templates/client/index";
import type { GitHubDeviceAuthorization } from "../../../src/templates/client/index";

const authorization: GitHubDeviceAuthorization = { deviceCode: "private-device", userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 };
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body }) as Response;

function server(replies: unknown[]) {
  const calls: Array<{ url: string; fields: URLSearchParams }> = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), fields: new URLSearchParams(String(init?.body ?? "")) });
    if (String(url).endsWith("/user")) return response({ login: "researcher" });
    return response(replies.shift());
  };
  return { fetch, calls };
}

it("requests only public_repo and validates the verification URL", async () => {
  const s = server([{ device_code: authorization.deviceCode, user_code: authorization.userCode, verification_uri: authorization.verificationUri, expires_in: 900, interval: 5 }]);
  await expect(startGitHubDeviceSignIn(s.fetch, "public-client", new AbortController().signal)).resolves.toEqual(authorization);
  expect(s.calls[0]?.fields.get("scope")).toBe("public_repo");
  expect(s.calls[0]?.fields.has("client_secret")).toBe(false);
  const bad = server([{ device_code: "x", user_code: "x", verification_uri: "https://attacker.example", expires_in: 900, interval: 5 }]);
  await expect(startGitHubDeviceSignIn(bad.fetch, "client", new AbortController().signal)).rejects.toThrow("invalid device");
});

it("waits for consent, backs off on slow_down, and identifies the authorized account", async () => {
  const s = server([{ error: "authorization_pending" }, { error: "slow_down" }, { access_token: "secret", token_type: "bearer" }]);
  let clock = 0;
  const waits: number[] = [];
  const result = await finishGitHubDeviceSignIn({ fetch: s.fetch, clientId: "public-client", authorization, signal: new AbortController().signal,
    now: () => clock, wait: async (ms) => { waits.push(ms); clock += ms; } });
  expect(result).toEqual({ token: "secret", login: "researcher" });
  expect(waits).toEqual([5000, 5000, 10000]);
  expect(s.calls.slice(0, 3).every((call) => call.fields.get("grant_type") === "urn:ietf:params:oauth:grant-type:device_code" && !call.fields.has("client_secret"))).toBe(true);
});

it.each(["access_denied", "expired_token", "device_flow_disabled"])("surfaces %s", async (error) => {
  const s = server([{ error }]);
  await expect(finishGitHubDeviceSignIn({ fetch: s.fetch, clientId: "client", authorization, signal: new AbortController().signal, wait: async () => {} })).rejects.toThrow(error);
});

it("stops at the device code deadline without another token request", async () => {
  const s = server([]);
  let clock = 0;
  await expect(finishGitHubDeviceSignIn({ fetch: s.fetch, clientId: "client", authorization: { ...authorization, expiresIn: 5 }, signal: new AbortController().signal,
    now: () => clock, wait: async (ms) => { clock += ms; } })).rejects.toThrow("expired");
  expect(s.calls).toEqual([]);
});

it("cancels while waiting without contacting the token endpoint", async () => {
  const s = server([]);
  const controller = new AbortController();
  const pending = finishGitHubDeviceSignIn({ fetch: s.fetch, clientId: "client", authorization, signal: controller.signal });
  controller.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  expect(s.calls).toEqual([]);
});
