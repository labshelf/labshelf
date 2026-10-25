// Types a refused Cloudflare sign-in or token request by its OAuth error code.
export class CloudflareOauthError extends Error {
  override readonly name = "CloudflareOauthError";

  /**
   * An OAuth error code (`invalid_grant`, `access_denied`, ...) or one of LabShelf's: `state_mismatch`, `no_code`,
   * `bad_response`, `unreachable`, `not_signed_in`. `invalid_grant` and `not_signed_in` mean the user must sign in again.
   */
  constructor(readonly code: string, detail: string) {
    super(`Cloudflare sign-in failed (${code}): ${detail}`);
  }
}
