// Requests GitHub device authorization without a client secret.
export interface GitHubDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export async function fetchGithubOAuthResponse(fetch: typeof globalThis.fetch, endpoint: string, fields: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(`https://github.com/login/${endpoint}`, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(), signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (!response.ok) throw new Error(`GitHub authorization failed (HTTP ${response.status})`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("GitHub returned an invalid authorization response");
  return body as Record<string, unknown>;
}

export async function startGitHubDeviceSignIn(fetch: typeof globalThis.fetch, clientId: string, signal: AbortSignal): Promise<GitHubDeviceAuthorization> {
  if (!clientId.trim()) throw new Error("This build has no GitHub OAuth Client ID. See the browser build setup.");
  const body = await fetchGithubOAuthResponse(fetch, "device/code", { client_id: clientId, scope: "public_repo" }, signal);
  if (typeof body.error === "string") throw new Error(`GitHub authorization failed: ${body.error}`);
  if (typeof body.device_code !== "string" || !body.device_code || typeof body.user_code !== "string" || !body.user_code
    || body.verification_uri !== "https://github.com/login/device"
    || !Number.isSafeInteger(body.expires_in) || Number(body.expires_in) <= 0 || Number(body.expires_in) > 900
    || !Number.isSafeInteger(body.interval) || Number(body.interval) <= 0) throw new Error("GitHub returned invalid device authorization fields");
  return { deviceCode: body.device_code, userCode: body.user_code, verificationUri: body.verification_uri,
    expiresIn: Number(body.expires_in), interval: Number(body.interval) };
}
