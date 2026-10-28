// Connects the owner's Cloudflare account: a sign-in (or a pasted token on a remote host), the account, then the relay deployed and serving.
// Holds the browser sign-in with its loopback callback, the ports the core account flows need and the failure report.
import * as http from "node:http";

import * as vscode from "vscode";

import {
  CLOUDFLARE_REDIRECT_PORT,
  CloudflareOauthError,
  connectRelayAccount,
  deriveConnectedPageUrl,
  fetchCloudflareTokens,
  formatError,
  readAuthorizationCode,
  readRelayWorkerScript,
  RELAY_PURPOSE,
  startCloudflareAuthorization,
  systemRelayClock,
  writeCloudflareTokens,
  type CloudflareAccount,
  type ILogger,
  type RelayAccountDeps,
  type RelayAccountStore,
  type RelayCredential,
} from "@labshelf/core";
import { LOG_MODULE, createLazyProgress } from "./accounts.js";

export const CONNECT_RELAY_COMMAND = "labshelf.relay.connect";
const TOKEN_PAGE = "https://dash.cloudflare.com/profile/api-tokens";
// INVARIANT: the same access as the OAuth scopes in core's oauthClient, so both credentials deploy alike.
const TOKEN_PERMISSIONS = "Create a custom token with Account · Workers Scripts: Edit, Account · Workers KV Storage: Edit "
  + "and Account · Account Settings: Read. The token stays on this device.";

export interface RelayDeps {
  accounts: RelayAccountStore;
  logger: ILogger;
}

export interface ConnectDeps extends RelayDeps {
  /** Offers the relay to the shared projects connected on this device. */
  offerToShares(): Promise<void>;
}

async function confirmSignIn(): Promise<boolean> {
  const signIn = "Sign In with Cloudflare";
  const answer = await vscode.window.showInformationMessage("Connect Cloudflare to give your shared projects a relay", {
    modal: true,
    detail: `${RELAY_PURPOSE}\n\nLabShelf opens Cloudflare in your browser, where you sign in and allow it to manage Workers in your account.`,
  }, signIn);
  return answer === signIn;
}

function askToken(): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    title: "Connect Cloudflare",
    prompt: `Paste the Cloudflare API token. ${TOKEN_PERMISSIONS}`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (/\s/.test(value.trim()) ? "A token has no spaces" : undefined),
  });
}

type Fallback = "paste" | "tokenPage" | "signIn";

/** Offered where the browser cannot come back to this host: a remote window, or a loopback port LabShelf cannot use. */
async function pickFallback(why: string, canSignIn: boolean): Promise<RelayCredential | "signIn" | undefined> {
  const items: (vscode.QuickPickItem & { choice: Fallback })[] = [
    { label: "Paste an API token", detail: TOKEN_PERMISSIONS, choice: "paste" },
    { label: "Create an API token", detail: "Opens the Cloudflare token page, then asks for the token", choice: "tokenPage" },
  ];
  if (canSignIn) { items.push({ label: "Sign in with Cloudflare", detail: "Works when port 8976 of this host is forwarded to your computer", choice: "signIn" }); }
  const picked = await vscode.window.showQuickPick(items, { title: "Connect Cloudflare", placeHolder: `${why}. ${RELAY_PURPOSE}`, ignoreFocusOut: true });
  if (!picked) { return undefined; }
  if (picked.choice === "signIn") { return "signIn"; }
  if (picked.choice === "tokenPage") { await vscode.env.openExternal(vscode.Uri.parse(TOKEN_PAGE)); }
  const token = (await askToken())?.trim();
  return token ? { kind: "token", token } : undefined;
}

async function signIn(deps: RelayDeps): Promise<RelayCredential | undefined> {
  try {
    await signInToCloudflare(deps);
    return { kind: "oauth" };
  } catch (error) {
    if (!(error instanceof OauthCallbackError)) { throw error; }
    await deps.logger.log("WARN", LOG_MODULE, "Offering a pasted token: the sign-in loopback is unavailable", { reason: error.reason });
    const fallback = await pickFallback(`Port 8976 on this device is busy (${error.reason}), so the browser sign-in cannot reach LabShelf`, false);
    return fallback === "signIn" ? undefined : fallback;
  }
}

async function chooseCredential(deps: RelayDeps): Promise<RelayCredential | undefined> {
  const remote = vscode.env.remoteName;
  if (!remote) { return (await confirmSignIn()) ? signIn(deps) : undefined; }
  await deps.logger.log("INFO", LOG_MODULE, "Offering a pasted token: the window runs on a remote host", { remote });
  const choice = await pickFallback("This window runs on a remote host, which the browser sign-in cannot reach", true);
  return choice === "signIn" ? signIn(deps) : choice;
}

async function chooseAccount(accounts: CloudflareAccount[]): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(accounts.map((account) => ({ label: account.name, description: account.id, id: account.id })), {
    title: "Connect Cloudflare", placeHolder: "Account to set up the relay in",
  });
  return picked?.id;
}

async function deployRelayAccount(deps: ConnectDeps): Promise<string | undefined> {
  const progress = createLazyProgress("Setting up your relay on Cloudflare");
  try {
    return await connectRelayAccount({
      ...createRelayAccountDeps(deps),
      chooseCredential: () => chooseCredential(deps),
      chooseAccount,
      script: readRelayWorkerScript(),
      offerToShares: () => { progress.close(); return deps.offerToShares(); },
      progress: (step) => progress.report(step === "deploying" ? "uploading the relay" : "waiting for its address to answer, which takes up to 4 minutes the first time"),
    });
  } finally {
    progress.close();
  }
}

/**
 * Resolves true once a relay is connected and serving. A cancel or a failure resolves false even when the account was
 * saved before the relay answered, so a caller decides by this outcome and not by the stored account.
 */
export async function connectRelay(deps: ConnectDeps): Promise<boolean> {
  const existing = await deps.accounts.get();
  if (existing) {
    void vscode.window.showInformationMessage(`Cloudflare is connected, with your relay at ${existing.relayUrl}. Disconnect it first to use another account.`);
    return true;
  }
  try {
    const relayUrl = await deployRelayAccount(deps);
    if (relayUrl) { void vscode.window.showInformationMessage(`Cloudflare connected. Your shared projects open here and the ones you share later list your relay at ${relayUrl}.`); }
    return relayUrl !== undefined;
  } catch (error) {
    reportRelayFailure(deps.logger, "connect Cloudflare", error);
    return false;
  }
}

const LOOPBACK_HOST = "127.0.0.1";
/** Long enough to sign in, create an account and approve; short enough that a forgotten tab frees the port. */
const CALLBACK_TIMEOUT_MS = 10 * 60_000;

/** The browser cannot be sent back to this host, so the user signs in another way. */
class OauthCallbackError extends Error {
  override readonly name = "OauthCallbackError";

  constructor(readonly reason: string) {
    super(`LabShelf cannot listen on ${LOOPBACK_HOST}:${CLOUDFLARE_REDIRECT_PORT} for the Cloudflare sign-in (${reason})`);
  }
}

interface CallbackOptions {
  /** Runs on the redirect; the browser is answered only after it settles, so the page shows the real outcome. */
  handle(callbackUrl: string): Promise<void>;
  cancel: vscode.CancellationToken;
}

interface OauthCallback {
  /** Settles after one callback is handled, on cancellation, or on the timeout. */
  done: Promise<void>;
  /** Stops listening; `done` rejects with a `CancellationError`. */
  close(): void;
}

const errorCodeOf = (error: unknown) => (error instanceof CloudflareOauthError ? error.code : "sign_in_failed");

function answerCallback(response: http.ServerResponse, error: unknown): void {
  // INVARIANT: the answer is only a redirect; tokens and codes never reach the page or the browser history.
  response.writeHead(302, { Location: deriveConnectedPageUrl(error === undefined ? undefined : errorCodeOf(error)), "Cache-Control": "no-store", Connection: "close" });
  response.end();
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => reject(new OauthCallbackError(error.code ?? error.message)));
    server.listen(CLOUDFLARE_REDIRECT_PORT, LOOPBACK_HOST, () => resolve());
  });
}

/** Resolves once the port listens; throws `OauthCallbackError` when it cannot (port in use, no permission). */
async function startOauthCallback({ handle, cancel }: CallbackOptions): Promise<OauthCallback> {
  let settle: (outcome: { error?: unknown }) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    settle = ({ error }) => (error === undefined ? resolve() : reject(error));
  });
  let answered = false;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}:${CLOUDFLARE_REDIRECT_PORT}`);
    if (url.pathname !== "/callback" || answered) { response.writeHead(404, { Connection: "close" }).end(); return; }
    answered = true;
    void handle(url.href).then((): { error?: unknown } => ({}), (error: unknown) => ({ error })).then((outcome) => {
      answerCallback(response, outcome.error);
      finish(outcome);
    });
  });
  const timer = setTimeout(() => finish({ error: new Error("the browser sign-in did not come back within 10 minutes") }), CALLBACK_TIMEOUT_MS);
  const cancelled = cancel.onCancellationRequested(() => finish({ error: new vscode.CancellationError() }));
  function finish(outcome: { error?: unknown }): void {
    clearTimeout(timer);
    cancelled.dispose();
    server.close();
    settle(outcome);
  }
  try {
    await listen(server);
  } catch (error) {
    finish({});
    throw error;
  }
  server.on("error", (error) => finish({ error }));
  return { done, close: () => finish({ error: new vscode.CancellationError() }) };
}

/** Throws `OauthCallbackError` before opening the browser when the redirect port cannot be used. */
async function signInToCloudflare(deps: RelayDeps): Promise<void> {
  const { accounts, logger } = deps;
  const authorization = await startCloudflareAuthorization();
  const progress = { location: vscode.ProgressLocation.Notification, title: "Sign in to Cloudflare in your browser", cancellable: true };
  await vscode.window.withProgress(progress, async (_progress, cancel) => {
    const callback = await startOauthCallback({
      cancel,
      handle: async (callbackUrl) => {
        const code = readAuthorizationCode(callbackUrl, authorization.state);
        const tokens = await fetchCloudflareTokens({ code, verifier: authorization.verifier, fetch: globalThis.fetch, logger, now: () => Date.now() });
        await writeCloudflareTokens(accounts.tokens, tokens);
      },
    });
    const consentUrl = vscode.Uri.parse(authorization.url);
    if (!(await vscode.env.openExternal(consentUrl))) {
      await logger.log("WARN", LOG_MODULE, "The browser did not open for the Cloudflare sign-in");
      callback.close();
    }
    await callback.done;
  });
  await logger.log("INFO", LOG_MODULE, "Signed in to Cloudflare");
}

export function createRelayAccountDeps(deps: RelayDeps): RelayAccountDeps {
  return {
    store: deps.accounts,
    fetch: globalThis.fetch,
    logger: deps.logger,
    clock: systemRelayClock,
    signInAgain: async () => {
      const again = "Sign In Again";
      const answer = await vscode.window.showWarningMessage(
        "Cloudflare no longer accepts LabShelf's sign-in. Sign in again so LabShelf can manage your relay.", again,
      );
      if (answer !== again) { return false; }
      await signInToCloudflare(deps);
      return true;
    },
  };
}

export function reportRelayFailure(logger: ILogger, action: string, error: unknown): void {
  if (error instanceof vscode.CancellationError) {
    void logger.log("INFO", LOG_MODULE, "Relay action cancelled", { action });
    return;
  }
  void logger.error(LOG_MODULE, error, { action });
  void vscode.window.showErrorMessage(`LabShelf could not ${action}: ${formatError(error)}`);
}
