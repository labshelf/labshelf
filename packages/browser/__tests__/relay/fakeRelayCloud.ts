// Fakes Cloudflare's token endpoint, its API and the deployed relay's /version as one recording fetch.
// A connect deploys two Workers under random `ls-` names; the fake answers any such name and tells the relay Worker
// (it uploads a Durable Object binding) from the share Worker (KV only) by the upload form.
import { RELAY_PROTOCOL_VERSION, RELAY_WORKER_BUILD } from "@labshelf/core";

const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const API = "https://api.cloudflare.com/client/v4";
const WORKER_NAME = "ls-[a-z2-7]{12}";
const WORKER_URL = new RegExp(`^https://${WORKER_NAME}\\.x\\.workers\\.dev`);
const SCRIPT_PATH = new RegExp(`^/accounts/acc/workers/scripts/(${WORKER_NAME})$`);
/** The relay address of an account saved before the test, not deployed through the fake. */
export const RELAY_URL = "https://ls-abcdefgh2345.x.workers.dev";

export interface FakeRelayCloud {
  fetch: typeof fetch;
  /** Every request as "METHOD url", in order. */
  requests: string[];
  /** The one refresh token Cloudflare still accepts; each grant rotates it. */
  liveRefreshToken: string;
  workerBuild: string;
  failScriptUpload: boolean;
  /** The address of the relay Worker the last connect deployed; undefined before any upload. */
  relayUrl(): string | undefined;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const envelope = (result: unknown) => json(200, { success: true, errors: [], result });

export function fakeRelayCloud(): FakeRelayCloud {
  const namespaces: { id: string; title: string }[] = [];
  let grants = 0;
  let relayName: string | undefined;
  const cloud: FakeRelayCloud = {
    requests: [], liveRefreshToken: "", workerBuild: RELAY_WORKER_BUILD, failScriptUpload: false,
    relayUrl: () => relayName && `https://${relayName}.x.workers.dev`,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      cloud.requests.push(`${method} ${url}`);
      if (url === TOKEN_URL) { return tokenGrant(new URLSearchParams(String(init?.body))); }
      if (WORKER_URL.test(url)) { return json(200, { v: RELAY_PROTOCOL_VERSION, worker: cloud.workerBuild }); }
      return await api(method, url.slice(API.length).replace(/\?.*$/, ""), init?.body);
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
  const api = async (method: string, path: string, body: unknown): Promise<Response> => {
    if (method === "GET" && path === "/accounts") { return envelope([{ id: "acc", name: "Lab" }]); }
    if (path === "/accounts/acc/storage/kv/namespaces") {
      if (method === "GET") { return envelope(namespaces); }
      if (method === "POST") {
        namespaces.push({ id: `kv-${namespaces.length + 1}`, title: (JSON.parse(String(body)) as { title: string }).title });
        return envelope({ id: namespaces.at(-1)?.id });
      }
    }
    if (method === "GET" && path === "/accounts/acc/workers/subdomain") { return envelope({ subdomain: "x" }); }
    const script = method === "PUT" ? SCRIPT_PATH.exec(path)?.[1] : undefined;
    if (script && cloud.failScriptUpload) {
      return json(500, { success: false, errors: [{ code: 10013, message: "internal error" }], result: null });
    }
    if (script && body instanceof FormData && (await uploadsDurableObject(body))) { relayName = script; }
    return envelope({});
  };
  return cloud;
}

async function uploadsDurableObject(form: FormData): Promise<boolean> {
  const metadata = form.get("metadata");
  return metadata instanceof Blob && (await new Response(metadata).text()).includes("durable_object_namespace");
}

export const isScriptUpload = (request: string) => new RegExp(`^PUT ${API}/accounts/acc/workers/scripts/${WORKER_NAME}$`).test(request);
