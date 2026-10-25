// Makes sure the extension may read the URL of the tab that reaches Cloudflare's loopback redirect.
import { bx } from "../platform";

const LOOPBACK_ORIGINS = ["http://127.0.0.1/*"];

// PLATFORM: Firefox MV3 lets the owner revoke site access; tabs.onUpdated then carries no URL and the redirect is never seen.
// The caller reports the refusal, so it is not logged here.
// TRAP: Firefox drops the user gesture once an await waits on another task, so this runs before any such await after the click.
export async function requestLoopbackAccess(): Promise<void> {
  if (await bx.permissions.request({ origins: LOOPBACK_ORIGINS })) { return; }
  throw new Error("LabShelf needs access to 127.0.0.1 to finish signing in to Cloudflare. "
    + "Allow it in the add-on's site access settings and try again.");
}
