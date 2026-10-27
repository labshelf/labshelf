// Fakes the Cloudflare API and a relay's /version as an injected fetch that records every request.
import type { ILogger } from "../../src/ports/index";

export interface RecordedRequest { method: string; path: string; headers: Record<string, string>; json?: unknown; form?: FormData | undefined }

export const ACCOUNT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
export const TOKEN = "tok-SECRET-0123456789abcdefghijklmnopqrstuvwxyz";
const API = "https://api.cloudflare.com/client/v4";

export interface FakeCloudflareOptions {
  validToken?: string;
  hasSubdomain?: boolean;
  /** Body of GET <relay>/version, or a status to answer with. */
  relayVersion?: unknown;
  existingKvNamespaces?: { id: string; title: string }[];
  /** PUT workers/subdomain answers 409 for this name. */
  takenSubdomain?: string;
  /** The token is account-owned: the user endpoint refuses it. */
  accountOwnedToken?: boolean;
  failScriptUploadWith?: { status: number; code: number; message: string };
}

export function fakeCloudflare(options: FakeCloudflareOptions = {}) {
  const validToken = options.validToken ?? TOKEN;
  const requests: RecordedRequest[] = [];
  let hasSubdomain = options.hasSubdomain ?? false;
  const envelope = (status: number, result: unknown) => new Response(JSON.stringify({ success: true, errors: [], result }), { status });
  const failure = (status: number, code: number, message: string) =>
    new Response(JSON.stringify({ success: false, errors: [{ code, message }], result: null }), { status });

  const fetchFake = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body;
    if (!url.href.startsWith(API)) {
      requests.push({ method, path: url.href, headers });
      return new Response(JSON.stringify(options.relayVersion ?? { v: "1.0", worker: "1.0.0" }), { status: 200 });
    }
    const path = url.href.slice(API.length);
    requests.push({ method, path, headers, json: typeof body === "string" ? JSON.parse(body) : undefined, form: body instanceof FormData ? body : undefined });
    if (headers.Authorization !== `Bearer ${validToken}`) { return failure(401, 1000, "Invalid API Token"); }
    const route = `${method} ${path.replace(ACCOUNT, "<A>").replace(/\?.*$/, "")}`;
    switch (route) {
      case "GET /user/tokens/verify":
        return options.accountOwnedToken ? failure(403, 9109, "Unauthorized to access requested resource") : envelope(200, { id: "t", status: "active" });
      case "GET /accounts/<A>/storage/kv/namespaces": return envelope(200, options.existingKvNamespaces ?? []);
      case "GET /accounts": return envelope(200, [{ id: ACCOUNT, name: "Lab" }]);
      case "POST /accounts/<A>/storage/kv/namespaces": return envelope(200, { id: "kv-1" });
      case "GET /accounts/<A>/workers/subdomain":
        return hasSubdomain ? envelope(200, { subdomain: "lab" }) : failure(404, 10007, "workers.dev subdomain not found");
      case "PUT /accounts/<A>/workers/subdomain":
        if ((JSON.parse(body as string) as { subdomain: string }).subdomain === options.takenSubdomain) { return failure(409, 10036, "subdomain already in use"); }
        hasSubdomain = true; return envelope(200, { subdomain: (JSON.parse(body as string) as { subdomain: string }).subdomain });
      case "PUT /accounts/<A>/workers/scripts/relay": {
        const fail = options.failScriptUploadWith;
        if (fail) { return failure(fail.status, fail.code, fail.message); }
        return hasSubdomain ? envelope(200, { id: "relay" }) : failure(403, 10063, "subdomain required");
      }
      case "PUT /accounts/<A>/workers/scripts/relay/secrets": return envelope(201, { name: "x" });
      case "POST /accounts/<A>/workers/scripts/relay/subdomain": return envelope(200, { enabled: true });
      default:
        return route.startsWith("DELETE ") ? envelope(200, {}) : failure(404, 7003, `no route ${route}`);
    }
  }) as typeof fetch;

  return { fetch: fetchFake, requests };
}

export function recordingLogger(): ILogger & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    async log(...args: unknown[]) { calls.push(args); },
    async error(...args: unknown[]) { calls.push(args); },
  } as unknown as ILogger & { calls: unknown[][] };
}

export const metadataOf = async (request: RecordedRequest) => JSON.parse(await (request.form!.get("metadata") as Blob).text()) as Record<string, unknown>;
