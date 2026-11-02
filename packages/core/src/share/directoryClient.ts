// Talks to the LabShelf directory: registers this library's inbox and keys under the user's Cloudflare email, looks up a recipient's keys
// and has the directory forward a sealed invite to them.
import { isRecord } from "../guards/index.js";
import { fingerprint } from "../collab/invite/index.js";

// CONTRACT: documents/contracts/directory.md#endpoints
export const DIRECTORY_URL = "https://labshelf.org/api/directory";

/** The contract's error codes, plus `refused` for a code or an answer this client does not know. */
export type DirectoryErrorReason = "unauthorized" | "not_found" | "rate_limited" | "too_large" | "bad_request" | "unavailable" | "refused";

const MESSAGES: Record<DirectoryErrorReason, string> = {
  unauthorized: "The LabShelf directory did not accept your Cloudflare sign-in.",
  not_found: "No LabShelf invitations for this email.",
  rate_limited: "Too many invitations for now; try again later.",
  too_large: "This invitation is too large to send.",
  bad_request: "The LabShelf directory refused the request.",
  unavailable: "The LabShelf directory cannot be reached right now.",
  refused: "The LabShelf directory refused the request.",
};

const CODES = new Set<string>(["unauthorized", "not_found", "rate_limited", "too_large", "bad_request", "unavailable"]);

export class DirectoryError extends Error {
  constructor(readonly reason: DirectoryErrorReason) {
    super(MESSAGES[reason]);
    this.name = "DirectoryError";
  }
}

export interface DirectoryRegistration { inboxUrl: string; inboxToken: string; encryptionKey: string; signingKey: string }
export interface DirectoryKeys { encryptionKey: string; signingKey: string; fingerprint: string }

export interface DirectoryClient {
  register(registration: DirectoryRegistration): Promise<void>;
  unregister(): Promise<void>;
  /** Undefined when the directory answers `not_found`. */
  lookup(email: string): Promise<DirectoryKeys | undefined>;
  send(email: string, sealed: Record<string, unknown>): Promise<void>;
}

export interface DirectoryClientOptions {
  /** The user's Cloudflare access token, sent as the bearer of every call. */
  accessToken(): Promise<string>;
  fetch?: typeof fetch;
  url?: string;
}

/** Every refusal throws a DirectoryError; a lookup's malformed or mismatched keys are `refused`. */
export function createDirectoryClient({ accessToken, fetch: doFetch = fetch, url = DIRECTORY_URL }: DirectoryClientOptions): DirectoryClient {
  async function post(path: string, body?: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      const headers: Record<string, string> = { authorization: `Bearer ${await accessToken()}` };
      if (body !== undefined) { headers["content-type"] = "application/json"; }
      response = await doFetch(`${url}${path}`, { method: "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch {
      throw new DirectoryError("unavailable");
    }
    if (response.status >= 500) { throw new DirectoryError("unavailable"); }
    let json: unknown;
    try { json = await response.json(); } catch { throw new DirectoryError(response.ok ? "refused" : "unavailable"); }
    if (response.ok) { return json; }
    const code = isRecord(json) ? json["error"] : undefined;
    throw new DirectoryError(typeof code === "string" && CODES.has(code) ? (code as DirectoryErrorReason) : "refused");
  }

  return {
    async register(registration) { await post("/register", { ...registration }); },
    async unregister() { await post("/unregister"); },
    async lookup(email) {
      let answer: unknown;
      try {
        answer = await post("/lookup", { email });
      } catch (error) {
        if (error instanceof DirectoryError && error.reason === "not_found") { return undefined; }
        throw error;
      }
      if (!isRecord(answer)) { throw new DirectoryError("refused"); }
      const { encryptionKey, signingKey, fingerprint: named } = answer;
      if (typeof encryptionKey !== "string" || typeof signingKey !== "string" || typeof named !== "string") { throw new DirectoryError("refused"); }
      // The fingerprint must name the keys, so a sealed invite's recipient is the identity the keys belong to.
      const derived = await fingerprint(encryptionKey, signingKey).catch(() => undefined);
      if (derived !== named) { throw new DirectoryError("refused"); }
      return { encryptionKey, signingKey, fingerprint: named };
    },
    async send(email, sealed) { await post("/send", { email, sealed }); },
  };
}
