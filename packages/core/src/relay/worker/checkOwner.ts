// Decides whether a request carries the owner secret, comparing it in constant time.

import type { RelayEnv } from "./cloudflareRuntime.js";
import { isSecretMatch } from "./hashSecret.js";

/** A Worker without `OWNER_SECRET` refuses every owner request and logs why. */
export async function checkOwnerSecret(request: Request, env: RelayEnv, endpoint: string): Promise<boolean> {
  if (!env.OWNER_SECRET) {
    console.error(`relay ${endpoint}: OWNER_SECRET is not set, refusing every owner request`);
    return false;
  }
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  return bearer !== undefined && isSecretMatch(bearer, env.OWNER_SECRET);
}
