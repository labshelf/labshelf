/** Reads the Cloudflare account email for Remote access. */

/** Reads the account email from GET /client/v4/user with the app's OAuth token. Answers undefined when the token has no
 * user-details access (401/403), the email is missing or the body is not the Cloudflare envelope; throws on a network
 * error or a server failure so the switch reports failed instead of asking for a sign-in. */
export async function readCloudflareEmail(accessToken: string, doFetch: typeof fetch = fetch): Promise<string | undefined> {
  const response = await doFetch("https://api.cloudflare.com/client/v4/user", { headers: { authorization: `Bearer ${accessToken}` } });
  if (response.status === 401 || response.status === 403) { return undefined; }
  if (!response.ok) { throw new Error(`Cloudflare answered ${response.status} when reading the account.`); }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  if (typeof body !== "object" || body === null) { return undefined; }
  const envelope = body as { success?: unknown; result?: unknown };
  if (envelope.success !== true || typeof envelope.result !== "object" || envelope.result === null) { return undefined; }
  const email = (envelope.result as { email?: unknown }).email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
}
