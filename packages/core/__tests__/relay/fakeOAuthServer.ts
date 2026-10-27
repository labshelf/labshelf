// Fakes Cloudflare's OAuth server: the consent redirect, the code exchange with PKCE and the refresh grant that rotates tokens.
import { createHash } from "node:crypto";

import type { StoredSecret } from "../../src/relay/index";

export const CLIENT_ID = "6bf60d8231e753c5249c7044aa0c4aff";
export const REDIRECT = "http://127.0.0.1:8976/callback";
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function fakeOAuthServer() {
  let issued = 0;
  let pending: { code: string; challenge: string } | undefined;
  const liveRefresh = new Set<string>();
  const grants: string[] = [];
  const mint = () => {
    issued += 1;
    const refresh = `refresh-${issued}`;
    liveRefresh.add(refresh);
    return { access_token: `access-${issued}`, refresh_token: refresh, expires_in: 3600, token_type: "bearer" };
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const refuse = (error: string) => json(400, { error, error_description: `refused: ${error}` });

  /** Plays the user's consent: answers the authorization URL with the callback the browser would open. */
  function approve(authorizationUrl: string, options: { state?: string; error?: string } = {}): string {
    const url = new URL(authorizationUrl);
    const params = url.searchParams;
    const callback = new URL(params.get("redirect_uri") ?? "");
    const state = options.state ?? params.get("state") ?? "";
    if (options.error) { return `${callback.href}?error=${options.error}&state=${state}`; }
    const code = `code-${issued + 1}`;
    pending = { code, challenge: params.get("code_challenge") ?? "" };
    return `${callback.href}?code=${code}&state=${state}`;
  }

  const fetchFake = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(input) !== TOKEN_URL || init?.method !== "POST") { return json(404, { error: "not_found" }); }
    const form = new URLSearchParams(String(init.body));
    grants.push(form.get("grant_type") ?? "");
    if (form.get("client_id") !== CLIENT_ID) { return refuse("invalid_client"); }
    if (form.get("grant_type") === "authorization_code") {
      const valid = pending && form.get("code") === pending.code && form.get("redirect_uri") === REDIRECT
        && s256(form.get("code_verifier") ?? "") === pending.challenge;
      pending = undefined;
      return valid ? json(200, mint()) : refuse("invalid_grant");
    }
    const refresh = form.get("refresh_token") ?? "";
    if (form.get("grant_type") !== "refresh_token" || !liveRefresh.delete(refresh)) { return refuse("invalid_grant"); }
    return json(200, mint());
  }) as typeof fetch;

  return { fetch: fetchFake, approve, grants, liveRefresh };
}

export function memorySlot(initial?: string): StoredSecret & { value: string | undefined; writes: string[] } {
  const slot = {
    value: initial,
    writes: [] as string[],
    async get() { return slot.value; },
    async store(value: string) { slot.writes.push(value); slot.value = value; },
    async delete() { slot.value = undefined; },
  };
  return slot;
}

/** A clock whose sleep advances time and yields, so concurrent waiters interleave deterministically. */
export function fakeClock(start = 1_000_000) {
  const clock = {
    time: start,
    now: () => clock.time,
    async sleep(ms: number) { clock.time += ms; await new Promise((resolve) => setImmediate(resolve)); },
  };
  return clock;
}
