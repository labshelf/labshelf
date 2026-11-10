/** The client of the relay Worker's /mirror/* write routes: the owner email, the writer lease, row batches and the clear
 * that turning Remote access off sends. Every call carries the owner secret as bearer and rejects when the Worker refuses. */
import { parseJsonObject } from "../json/parseJsonObject.js";
import type { MirrorRow } from "./mirrorState.js";

/** One row of a `POST /mirror/rows` request: its library-relative path, kind, content hash, byte size and text. */
export interface MirrorPut { path: string; kind: MirrorRow["kind"]; hash: string; size: number; value: string }

export interface MirrorRelay {
  putOwner(email: string): Promise<void>;
  lease(action: "acquire" | "renew" | "release"): Promise<boolean>;
  putRows(rows: MirrorPut[], remove: string[]): Promise<void>;
  clear(): Promise<void>;
}

async function refusal(response: Response, route: string): Promise<Error> {
  let code = "";
  try {
    const body = parseJsonObject(await response.text());
    if (typeof body?.["error"] === "string") { code = ` (${body["error"]})`; }
  } catch {
    // An unreadable body only loses the code.
  }
  return new Error(`The relay refused ${route}: ${response.status}${code}`);
}

export function createMirrorRelay(options: { relayUrl: string; ownerSecret: string; deviceId: string; fetch: typeof fetch }): MirrorRelay {
  const base = options.relayUrl.replace(/\/+$/, "");

  async function call(method: string, route: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${options.ownerSecret}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await options.fetch(`${base}${route}`, init);
    if (!response.ok) { throw await refusal(response, `${method} ${route}`); }
    return response;
  }

  return {
    async putOwner(email) {
      await call("PUT", "/mirror/owner", { email });
    },
    async lease(action) {
      const response = await call("POST", "/mirror/lease", { deviceId: options.deviceId, action });
      return parseJsonObject(await response.text())?.["held"] === true;
    },
    async putRows(rows, remove) {
      await call("POST", "/mirror/rows", { put: rows, delete: remove });
    },
    async clear() {
      await call("DELETE", "/mirror/rows");
    },
  };
}
