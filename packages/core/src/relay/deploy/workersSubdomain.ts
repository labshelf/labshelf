// Ensures an account has a workers.dev subdomain, creating one on a fresh account.
import { CloudflareApiError, type CloudflareClient } from "./api/index.js";

const NO_SUBDOMAIN_CODE = 10007;

/** Returns the account's subdomain; a fresh account has none (404, code 10007), so one derived from its id is created. */
export async function ensureWorkersSubdomain(client: CloudflareClient, accountId: string): Promise<string> {
  const path = `/accounts/${accountId}/workers/subdomain`;
  try {
    const existing = subdomainOf(await client.call("GET", path));
    if (existing) { return existing; }
  } catch (error) {
    if (!(error instanceof CloudflareApiError) || error.code !== NO_SUBDOMAIN_CODE) { throw error; }
  }
  const created = subdomainOf(await putSubdomain(client, path, accountId));
  if (!created) { throw new Error("Cloudflare created the workers.dev subdomain but did not report its name."); }
  return created;
}

// A taken name is refused with 400 or 409; one retry with a random suffix avoids a second collision.
async function putSubdomain(client: CloudflareClient, path: string, accountId: string): Promise<unknown> {
  const name = derivedSubdomain(accountId);
  try {
    return await client.call("PUT", path, { subdomain: name });
  } catch (error) {
    if (!(error instanceof CloudflareApiError) || (error.status !== 400 && error.status !== 409)) { throw error; }
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return client.call("PUT", path, { subdomain: `${name}-${suffix}` });
  }
}

/** A DNS label of at most 63 characters, made of lowercase letters, digits and hyphens. */
function derivedSubdomain(accountId: string): string {
  return `labshelf-${accountId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}`;
}

function subdomainOf(result: unknown): string | undefined {
  const value = typeof result === "object" && result !== null ? (result as { subdomain?: unknown }).subdomain : undefined;
  return typeof value === "string" && value !== "" ? value : undefined;
}
