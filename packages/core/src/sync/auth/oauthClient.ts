/** Chooses the Google OAuth client: the environment override first, then the credentials bundled at build time. */

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/**
 * A secret may be absent (public clients) or a template placeholder, which both read as "no secret".
 * @returns the client, or undefined when no real client id is configured
 */
export function resolveOAuthClient(
  env: Readonly<Record<string, string | undefined>>,
  builtIn: OAuthClient,
): OAuthClient | undefined {
  const clientId = env["LABSHELF_GOOGLE_CLIENT_ID"] || builtIn.clientId;
  const clientSecret = env["LABSHELF_GOOGLE_CLIENT_SECRET"] || builtIn.clientSecret;
  if (!clientId || clientId.startsWith("YOUR_")) { return undefined; }
  return { clientId, clientSecret: clientSecret.startsWith("YOUR_") ? "" : clientSecret };
}
