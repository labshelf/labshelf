/** The error for a Google Drive session that only a new sign-in can restore. */

export const DEFAULT_SIGN_IN_HINT = "Sign in to continue.";

/** Raised when there are no tokens or the stored refresh token no longer works. */
export class ReauthRequiredError extends Error {
  /**
   * @param signInHint how this app signs in, e.g. the command to run
   * @param reason "expired" for a rejected refresh token, "signed-out" when no tokens exist
   */
  constructor(signInHint = DEFAULT_SIGN_IN_HINT, reason: "expired" | "signed-out" = "expired") {
    super(`${reason === "expired" ? "Google Drive access expired or was revoked." : "Not signed in to Google Drive."} ${signInHint}`);
    this.name = "ReauthRequiredError";
  }
}
