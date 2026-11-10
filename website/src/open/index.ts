// The /open/ entry: handles the Cloudflare return before anything else, then opens the remote library with the in-memory token (composed in openWorkspace.ts).
import { beginSignIn, finishSignIn } from "./signIn.js";
import { openRemoteLibrary, type OpenState } from "./remoteClient.js";

export { mountRemoteLibrary } from "./openWorkspace.js";

const OFF_TEXT = "Remote access is off";
const OTHER_ACCOUNT_TEXT = "This LabShelf belongs to another Cloudflare account";

/** The page text of a state that shows no library; undefined for `ready`. */
export function stateText(state: OpenState): string | undefined {
  switch (state.kind) {
    case "ready": return undefined;
    case "off": return OFF_TEXT;
    case "other_account": return OTHER_ACCOUNT_TEXT;
    case "not_registered": return "This Cloudflare account has no LabShelf relay registered";
    case "failed": return state.message;
  }
}

/** Starts the Cloudflare sign-in; the page leaves for Cloudflare and comes back with the code. */
export async function connect(): Promise<void> {
  await beginSignIn({ storage: window.sessionStorage, location: window.location });
}

/** Resolves to the open state when Cloudflare just sent the page back, or undefined when it did not (the visitor still has to connect). The token never leaves this call's closure. */
export async function openPage(): Promise<OpenState | undefined> {
  const env = { storage: window.sessionStorage, location: window.location };
  const token = await finishSignIn({ ...env, fetch: window.fetch.bind(window) });
  if (token === undefined) { return undefined; }
  // The code and state leave the URL right after the exchange, before any reload can replay them.
  window.history.replaceState(null, "", window.location.pathname);
  return openRemoteLibrary(token, { fetch: window.fetch.bind(window) });
}

