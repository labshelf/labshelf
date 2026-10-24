// Verifies a pasted API token and lists the accounts it can use.
import type { CloudflareClient } from "./cloudflareClient.js";
import { CloudflareApiError } from "./cloudflareError.js";

export interface CloudflareAccount { id: string; name: string }

/**
 * Throws a `CloudflareApiError` when Cloudflare refuses the token or it is no longer active.
 * An account-owned token fails the user endpoint, so a refusal falls back to listing accounts: a list means a valid token.
 */
export async function verifyCloudflareToken(client: CloudflareClient): Promise<void> {
  try {
    await verifyUserToken(client);
  } catch (error) {
    if (!(error instanceof CloudflareApiError) || (error.status !== 401 && error.status !== 403)) { throw error; }
    if ((await listCloudflareAccounts(client).catch(() => [])).length === 0) { throw error; }
  }
}

async function verifyUserToken(client: CloudflareClient): Promise<void> {
  const result = await client.call("GET", "/user/tokens/verify");
  const status = isRecord(result) ? result.status : undefined;
  if (status !== "active") {
    throw new CloudflareApiError("GET", "/user/tokens/verify", 401, 0, `the token is ${typeof status === "string" ? status : "not active"}`);
  }
}

/** The accounts the token reaches; the caller picks when there are several. */
export async function listCloudflareAccounts(client: CloudflareClient): Promise<CloudflareAccount[]> {
  const result = await client.call("GET", "/accounts");
  if (!Array.isArray(result)) { return []; }
  return result.flatMap((item: unknown) =>
    isRecord(item) && typeof item.id === "string" ? [{ id: item.id, name: typeof item.name === "string" ? item.name : item.id }] : []);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
