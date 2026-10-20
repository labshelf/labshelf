// Fakes Cloudflare's token endpoint, its API and the deployed relay's /version as one recording fetch.
import { RELAY_PROTOCOL_VERSION, RELAY_WORKER_BUILD } from "@labshelf/core";

const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const API = "https://api.cloudflare.com/client/v4";
export const RELAY_URL = "https://labshelf-relay.x.workers.dev";

export interface FakeRelayCloud {
  fetch: typeof fetch;
  /** Every request as "METHOD url", in order. */
  requests: string[];
  /** The one refresh token Cloudflare still accepts; each grant rotates it. */
  liveRefreshToken: string;
  workerBuild: string;
  failScriptUpload: boolean;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const envelope = (result: unknown) => json(200, { success: true, errors: [], result });

export function fakeRelayCloud(): FakeRelayCloud {
  const namespaces: { id: string; title: string }[] = [];
  let grants = 0;
  const cloud: FakeRelayCloud = {
    requests: [], liveRefreshToken: "", workerBuild: RELAY_WORKER_BUILD, failScriptUpload: false,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      cloud.requests.push(`${method} ${url}`);
      if (url === TOKEN_URL) { return tokenGrant(new URLSearchParams(String(init?.body))); }
      if (url.startsWith(RELAY_URL)) { return json(200, { v: RELAY_PROTOCOL_VERSION, worker: cloud.workerBuild }); }
      return api(method, url.slice(API.length).replace(/\?.*$/, ""), init?.body);
    }) as typeof fetch,
  };
  const tokenGrant = (form: URLSearchParams): Response => {
    if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") !== cloud.liveRefreshToken) {
      return json(400, { error: "invalid_grant", error_description: "refresh token revoked" });
    }
    grants += 1;
    cloud.liveRefreshToken = `rt-${grants}`;
    return json(200, { access_token: `at-${grants}`, refresh_token: cloud.liveRefreshToken, expires_in: 3600 });
  };
  const api = (method: string, path: string, body: unknown): Response => {
    if (method === "GET" && path === "/accounts") { return envelope([{ id: "acc", name: "Lab" }]); }
    if (path === "/accounts/acc/storage/kv/namespaces") {
      if (method === "GET") { return envelope(namespaces); }
      if (method === "POST") {
        namespaces.push({ id: `kv-${namespaces.length + 1}`, title: (JSON.parse(String(body)) as { title: string }).title });
        return envelope({ id: namespaces.at(-1)?.id });
      }
    }
    if (method === "GET" && path === "/accounts/acc/workers/subdomain") { return envelope({ subdomain: "x" }); }
    if (method === "PUT" && path === "/accounts/acc/workers/scripts/labshelf-relay" && cloud.failScriptUpload) {
      return json(500, { success: false, errors: [{ code: 10013, message: "internal error" }], result: null });
    }
    return envelope({});
  };
  return cloud;
}

export const isScriptUpload = (request: string) => request === "PUT https://api.cloudflare.com/client/v4/accounts/acc/workers/scripts/labshelf-relay";
