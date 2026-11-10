// POST /api/oauth/token (documents/contracts/directory.md#endpoints): a code-exchange proxy, since Cloudflare's token endpoint sends no CORS header.
import { errorResponse, json, Refusal, type DirectoryDeps } from "./common";

const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const CLIENT_ID = "6bf60d8231e753c5249c7044aa0c4aff";
const REDIRECT_URI = "https://labshelf.org/open/";
const FORM_MAX_BYTES = 8 * 1024;
const FORWARDED = ["grant_type", "client_id", "redirect_uri", "code", "code_verifier"] as const;

/** The exchange form, or a refusal for any other grant, client or redirect. */
async function readExchange(request: Request): Promise<URLSearchParams> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > FORM_MAX_BYTES) { throw new Refusal("too_large"); }
  const form = new URLSearchParams(text);
  const one = (name: string) => { const values = form.getAll(name); return values.length === 1 ? values[0] : undefined; };
  if (one("grant_type") !== "authorization_code" || one("client_id") !== CLIENT_ID || one("redirect_uri") !== REDIRECT_URI
    || !one("code") || !one("code_verifier")) {
    throw new Refusal("bad_request");
  }
  const forward = new URLSearchParams();
  for (const name of FORWARDED) { forward.set(name, one(name) as string); }
  return forward;
}

/** Forwards a code exchange to Cloudflare and returns its status and JSON; it logs nothing, as the form and answer carry secrets. */
export async function proxyOauthToken(request: Request, deps: DirectoryDeps): Promise<Response> {
  try {
    const form = await readExchange(request);
    let upstream: Response;
    try {
      upstream = await deps.fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: form.toString(),
      });
    } catch {
      throw new Refusal("unavailable");
    }
    const body: unknown = await upstream.json().catch(() => undefined);
    if (body === undefined) { throw new Refusal("unavailable"); }
    const response = json(body, upstream.status);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
