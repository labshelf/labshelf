// Calls the Cloudflare v4 API with a bearer token and turns failures into typed errors, logging each call without bodies or the token.
import type { ILogger } from "../../../ports/index.js";
import { CloudflareApiError } from "./cloudflareError.js";

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const LOG_MODULE = "relay.deploy";

export interface CloudflareClientOptions { token: string; fetch: typeof fetch; logger: ILogger }

export interface CloudflareClient {
  /** Resolves with the response's `result` (the whole body when it has none); `body` is JSON, or FormData sent as multipart. */
  call(method: string, path: string, body?: unknown): Promise<unknown>;
}

export function createCloudflareClient({ token, fetch: doFetch, logger }: CloudflareClientOptions): CloudflareClient {
  return {
    async call(method, path, body) {
      // TRAP: the headers and body carry the token and secrets, so only method, path and status reach the log.
      const init = requestInit(method, token, body);
      let response: Response;
      try {
        response = await doFetch(`${CLOUDFLARE_API}${path}`, init);
      } catch (error) {
        const failure = new CloudflareApiError(method, path, 0, 0, error instanceof Error ? error.message : String(error));
        await logger.log("ERROR", LOG_MODULE, "Cloudflare API unreachable", { method, path, error: failure.cloudflareMessage });
        throw failure;
      }
      const parsed = await readJson(response);
      const failure = failureOf(method, path, response, parsed);
      if (failure) {
        await logger.log("ERROR", LOG_MODULE, "Cloudflare API call failed", { method, path, status: failure.status, code: failure.code, error: failure.cloudflareMessage });
        throw failure;
      }
      await logger.log("INFO", LOG_MODULE, "Cloudflare API call", { method, path, status: response.status });
      return isRecord(parsed) && "result" in parsed ? parsed.result : parsed;
    },
  };
}

// FormData sets its own multipart Content-Type with the boundary.
function requestInit(method: string, token: string, body: unknown): RequestInit {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body === undefined) { return { method, headers }; }
  if (body instanceof FormData) { return { method, headers, body }; }
  return { method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

function failureOf(method: string, path: string, response: Response, parsed: unknown): CloudflareApiError | undefined {
  const errors = isRecord(parsed) && Array.isArray(parsed.errors) ? parsed.errors : [];
  const first: unknown = errors[0];
  const code = isRecord(first) && typeof first.code === "number" ? first.code : 0;
  const message = isRecord(first) && typeof first.message === "string" ? first.message : undefined;
  const refused = isRecord(parsed) && parsed.success === false;
  if (response.ok && !refused) { return undefined; }
  const fallback = typeof parsed === "string" && parsed !== "" ? parsed.slice(0, 200) : response.statusText || "no details";
  return new CloudflareApiError(method, path, response.status, code, message ?? fallback);
}
