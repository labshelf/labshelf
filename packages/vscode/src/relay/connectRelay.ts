// Connects the owner's Cloudflare account: a token guide, the token, the account, then the relay deployed and serving.
import * as vscode from "vscode";

import {
  createCloudflareClient, deployRelay, listCloudflareAccounts, verifyCloudflareToken, waitUntilServing, type CloudflareClient, type ILogger,
} from "@labshelf/core";
import { LOG_MODULE, RELAY_WORKER_NAME, type RelayAccounts } from "./relayAccounts.js";
import { reportRelayFailure } from "./relayFailure.js";
import { relayWorkerScript } from "./relayWorkerScript.js";

export const CONNECT_RELAY_COMMAND = "labshelf.relay.connect";
const TOKEN_PAGE = "https://dash.cloudflare.com/profile/api-tokens";

export interface RelayDeps {
  accounts: RelayAccounts;
  logger: ILogger;
}

export interface ConnectDeps extends RelayDeps {
  /** Offers the relay to the shared projects connected on this device. */
  offerToShares(): Promise<void>;
}

async function showGuide(): Promise<boolean> {
  const open = "Open Token Page";
  const paste = "Paste Token";
  const answer = await vscode.window.showInformationMessage("Connect Cloudflare to give your shared projects a relay", {
    modal: true,
    detail: "LabShelf sets up a small relay in your own Cloudflare account, on the free plan. It keeps your projects' edits, encrypted, "
      + "so collaborators sync even when you are offline, and it connects them when a network blocks direct links.\n\n"
      + "Create an API token with \"Create Custom Token\" and these permissions:\n"
      + "- Account · Workers Scripts: Edit\n- Account · Workers KV Storage: Edit\n- Account · Cloudflare Calls/Realtime: Edit (TURN)\n"
      + "- Account · Account Settings: Read\n\nThe token stays on this device.",
  }, open, paste);
  if (answer === open) { await vscode.env.openExternal(vscode.Uri.parse(TOKEN_PAGE)); }
  return answer === open || answer === paste;
}

function askToken(): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    title: "Connect Cloudflare",
    prompt: "Paste the Cloudflare API token",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (/\s/.test(value.trim()) ? "A token has no spaces" : undefined),
  });
}

async function pickAccount(client: CloudflareClient): Promise<string | undefined> {
  const accounts = await listCloudflareAccounts(client);
  if (accounts.length === 0) { throw new Error("the token reaches no Cloudflare account; give it the account permissions in the guide"); }
  if (accounts.length === 1) { return accounts[0]?.id; }
  const picked = await vscode.window.showQuickPick(accounts.map((account) => ({ label: account.name, description: account.id, id: account.id })), {
    title: "Connect Cloudflare", placeHolder: "Account to set up the relay in",
  });
  return picked?.id;
}

const clock = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

async function deploy(deps: RelayDeps, token: string, accountId: string): Promise<string> {
  const { logger } = deps;
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Setting up your relay on Cloudflare" }, async (progress) => {
    progress.report({ message: "uploading the relay" });
    const deployed = await deployRelay({ token, accountId, script: relayWorkerScript(), workerName: RELAY_WORKER_NAME, logger, fetch: globalThis.fetch });
    // Saved before the wait, so a relay that answers late is still used and can be deleted.
    await deps.accounts.save({ token, accountId, ...deployed });
    progress.report({ message: "waiting for its address to answer, which takes up to 4 minutes the first time" });
    await waitUntilServing({ relayUrl: deployed.relayUrl, fetch: globalThis.fetch, logger, clock });
    return deployed.relayUrl;
  });
}

export async function connectRelay(deps: ConnectDeps): Promise<void> {
  const existing = await deps.accounts.get();
  if (existing) {
    void vscode.window.showInformationMessage(`Cloudflare is connected, with your relay at ${existing.relayUrl}. Disconnect it first to use another account.`);
    return;
  }
  if (!(await showGuide())) { return; }
  const token = (await askToken())?.trim();
  if (!token) { return; }
  try {
    const client = createCloudflareClient({ token, fetch: globalThis.fetch, logger: deps.logger });
    await verifyCloudflareToken(client);
    const accountId = await pickAccount(client);
    if (!accountId) { return; }
    const relayUrl = await deploy(deps, token, accountId);
    void deps.logger.log("INFO", LOG_MODULE, "Connected Cloudflare", { accountId, relayUrl });
    await deps.offerToShares();
    void vscode.window.showInformationMessage(`Cloudflare connected. Your shared projects open here and the ones you share later list your relay at ${relayUrl}.`);
  } catch (error) {
    reportRelayFailure(deps.logger, "connect Cloudflare", error);
  }
}
