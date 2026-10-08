/**
 * Authentication contract of a RemoteProvider. Each app implements it with its own sign-in: PkceLoopbackAuth in
 * VS Code and the terminal, the identity API in the browser.
 */
export interface IAuthProvider {
  /** Returns true when valid credentials are held in memory. */
  isAuthenticated(): boolean;
  /** Returns a valid access token, refreshing first if needed. */
  getAccessToken(): Promise<string>;
  /** Runs the authentication flow and persists credentials. */
  authenticate(): Promise<void>;
  /** Revokes credentials and clears any persisted state. */
  revoke(): Promise<void>;
}
