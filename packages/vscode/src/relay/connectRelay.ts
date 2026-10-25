// Connects the owner's Cloudflare account: a sign-in (or a pasted token on a remote host), the account, then the relay deployed and serving.
import * as vscode from "vscode";

import { connectRelayAccount, readRelayWorkerScript, type CloudflareAccount, type ILogger, type RelayAccountStore, type RelayCredential } from "@labshelf/core";
import { LOG_MODULE } from "./relayAccounts.js";
import { createRelayAccountDeps } from "./createRelayAccountDeps.js";
import { createLazyProgress } from "./relayProgress.js";
import { reportRelayFailure } from "./relayFailure.js";
import { LoopbackUnavailableError } from "./oauthCallback.js";
import { signInToCloudflare } from "./cloudflareSignIn.js";

export const CONNECT_RELAY_COMMAND = "labshelf.relay.connect";
const TOKEN_PAGE = "https://dash.cloudflare.com/profile/api-tokens";
const RELAY_PURPOSE = "LabShelf sets up a small relay in your own Cloudflare account, on the free plan. It carries every edit between "
  + "collaborators, end-to-end encrypted, and keeps them so collaborators sync even when you are offline.";
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
    if (!(error instanceof LoopbackUnavailableError)) { throw error; }
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
