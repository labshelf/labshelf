// Names LabShelf's public Cloudflare OAuth client: its id, endpoints, loopback redirect and scopes.
export const CLOUDFLARE_CLIENT_ID = "6bf60d8231e753c5249c7044aa0c4aff";
export const CLOUDFLARE_AUTHORIZE_URL = "https://dash.cloudflare.com/oauth2/auth";
export const CLOUDFLARE_TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
/** Registered exactly, port included: the desktop app listens here for the consent redirect. */
export const CLOUDFLARE_REDIRECT_PORT = 8976;
export const CLOUDFLARE_REDIRECT_URI = `http://127.0.0.1:${CLOUDFLARE_REDIRECT_PORT}/callback`;
// TRAP: the server checks every scope against the client's registered list before login, and refuses with invalid_scope.
export const CLOUDFLARE_SCOPES = "workers-scripts.admin workers-kv-storage.write account-settings.read offline_access";
const CONNECTED_PAGE = "https://labshelf.org/connected/?service=cloudflare";

/** The page the loopback sends the browser to; it carries an error code, never a token or a code. */
export function deriveConnectedPageUrl(errorCode?: string): string {
  return errorCode ? `${CONNECTED_PAGE}&error=${encodeURIComponent(errorCode)}` : CONNECTED_PAGE;
}
