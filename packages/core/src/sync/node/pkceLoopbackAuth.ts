/**
 * Google Drive sign-in for apps that can run a local server: OAuth 2.0 Authorization Code + PKCE with a loopback
 * redirect, tokens in an injected TokenStore. The app supplies the browser launcher and the token storage.
 */
import { describeError } from "../../logging/index.js";
import type { ILogger } from "../../ports/index.js";
import {
  DEFAULT_SIGN_IN_HINT, exchangeCode, GOOGLE_AUTH_URL, GOOGLE_DRIVE_SCOPES, ReauthRequiredError, refreshTokens, revokeToken,
  type FetchFn, type OAuthClient, type TokenData, type TokenStore,
} from "../auth/index.js";
import type { IAuthProvider } from "../provider/index.js";
import { LOGIN_TIMEOUT_MS, waitForAuthorizationCode } from "./loopbackCodeServer.js";
import { createPkceParams } from "./pkce.js";

const REFRESH_LEEWAY_MS = 60_000;
const LOG_MODULE = "sync/auth";
const SUCCESS_MESSAGE = "LabShelf is connected to Google Drive. You can close this tab.";

/** How a login reaches the user. */
export interface LoginPrompt {
  /** Opens the authorization URL; a failure (or rejection) is logged and the login keeps waiting. */
  openBrowser: (url: string) => void | Promise<void>;
  /** Receives the authorization URL as soon as it is known, for apps that show it when no browser opens. */
  onUrl?: (url: string) => void;
  timeoutMs?: number;
}

export interface PkceLoopbackOptions extends LoginPrompt {
  logger?: ILogger;
  /** Tells the user how to sign in again; ends the ReauthRequiredError messages. */
  signInHint?: string;
  /** Shown in the browser tab after a successful redirect. */
  successMessage?: string;
}

export class PkceLoopbackAuth implements IAuthProvider {
  private tokens: TokenData | null = null;
  private loaded = false;
  private refreshing: Promise<string> | null = null;
  private readonly signInHint: string;

  constructor(
    private readonly client: OAuthClient | undefined,
    private readonly store: TokenStore,
    private readonly fetchImpl: FetchFn,
    private readonly options: PkceLoopbackOptions,
  ) {
    this.signInHint = options.signInHint ?? DEFAULT_SIGN_IN_HINT;
  }

  /** @returns where the tokens are kept */
  get storeKind(): TokenStore["kind"] {
    return this.store.kind;
  }

  /** @returns true when an OAuth client is configured at all */
  isConfigured(): boolean {
    return this.client !== undefined;
  }

  /**
   * Loads the stored tokens once.
   * @returns void
   */
  async load(): Promise<void> {
    if (this.loaded) { return; }
    this.tokens = await this.store.load();
    this.loaded = true;
  }

  isAuthenticated(): boolean {
    return this.tokens !== null;
  }

  /**
   * Single-flight: concurrent callers share one refresh, so a rotated refresh token is never spent twice.
   * @throws ReauthRequiredError when signed out or the refresh token was rejected
   * @returns a valid access token
   */
  async getAccessToken(): Promise<string> {
    await this.load();
    if (!this.tokens) { throw new ReauthRequiredError(this.signInHint, "signed-out"); }
    if (this.tokens.expiry_ms > Date.now() + REFRESH_LEEWAY_MS && this.tokens.access_token) { return this.tokens.access_token; }
    this.refreshing ??= this.refresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /** IAuthProvider.authenticate: keeps stored tokens, otherwise signs in. */
  async authenticate(): Promise<void> {
    await this.load();
    if (!this.tokens) { await this.login(); }
  }

  /**
   * Runs the PKCE loopback flow and stores the tokens.
   * @param prompt overrides the construction-time prompt for this login only
   * @returns void
   */
  async login(prompt: Partial<LoginPrompt> = {}): Promise<void> {
    const client = this.requireClient();
    const { openBrowser, onUrl, timeoutMs } = { ...this.options, ...prompt };
    await this.log("INFO", "Google sign-in started");
    try {
      const pkce = createPkceParams();
      const { code, redirectUri } = await waitForAuthorizationCode({
        state: pkce.state,
        timeoutMs: timeoutMs ?? LOGIN_TIMEOUT_MS,
        successMessage: this.options.successMessage ?? SUCCESS_MESSAGE,
        onListening: (uri) => {
          const url = this.authorizationUrl(client, uri, pkce);
          onUrl?.(url);
          void this.launchBrowser(openBrowser, url);
        },
      });
      const granted = await exchangeCode(this.fetchImpl, client, { code, verifier: pkce.verifier, redirectUri });
      if (!granted.refresh_token) { throw new Error("Google did not return a refresh token; try signing in again."); }
      this.tokens = { access_token: granted.access_token, refresh_token: granted.refresh_token, expiry_ms: granted.expiry_ms };
      this.loaded = true;
      await this.store.save(this.tokens);
    } catch (error) {
      await this.log("WARN", "Google sign-in failed", { message: describeError(error).message });
      throw error;
    }
    await this.log("INFO", "Google sign-in completed", { store: this.store.kind });
  }

  /**
   * Revokes the refresh token (best effort) and forgets the tokens.
   * @returns void
   */
  async revoke(): Promise<void> {
    await this.load();
    const previous = this.tokens;
    this.tokens = null;
    await this.store.clear();
    if (!previous) { return; }
    try {
      await revokeToken(this.fetchImpl, previous.refresh_token);
    } catch (error) {
      await this.log("WARN", "Revoking the Google token failed; the tokens are forgotten locally", { message: describeError(error).message });
    }
  }

  private requireClient(): OAuthClient {
    if (!this.client) {
      throw new Error("No Google OAuth client configured. Set LABSHELF_GOOGLE_CLIENT_ID/SECRET or rebuild with the OAuth credentials.");
    }
    return this.client;
  }

  private authorizationUrl(client: OAuthClient, redirectUri: string, pkce: { challenge: string; state: string }): string {
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", GOOGLE_DRIVE_SCOPES.join(" "));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", pkce.state);
    return url.toString();
  }

  // The URL also reaches onUrl, so a launch failure leaves the user able to open it by hand while the server waits.
  private async launchBrowser(openBrowser: LoginPrompt["openBrowser"], url: string): Promise<void> {
    try {
      await openBrowser(url);
    } catch (error) {
      await this.log("WARN", "Could not open the browser for Google sign-in", { message: describeError(error).message });
    }
  }

  private async refresh(): Promise<string> {
    const client = this.requireClient();
    const current = this.tokens!;
    try {
      this.tokens = await refreshTokens(this.fetchImpl, client, current, this.signInHint);
    } catch (error) {
      if (error instanceof ReauthRequiredError) {
        this.tokens = null;
        await this.store.clear();
        await this.log("WARN", "Google rejected the refresh token (invalid_grant); the tokens were cleared");
      }
      throw error;
    }
    await this.store.save(this.tokens);
    await this.log("INFO", "Google access token refreshed");
    return this.tokens.access_token;
  }

  private async log(level: "INFO" | "WARN", message: string, context: Record<string, unknown> = {}): Promise<void> {
    await this.options.logger?.log(level, LOG_MODULE, message, context);
  }
}
