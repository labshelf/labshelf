// Gives a library page its Cloudflare relay: the account a share asks for, and the connect or disconnect the owner starts.
import {
  type ILogger,
  type RelayAccount,
  formatError,
  type CloudflareAccount,
  RELAY_PURPOSE,
} from "@labshelf/core";
import { showToast, pickQuickEntry, showDialog } from "@labshelf/core/dom";
import { createBrowserRelayAccount, type BrowserRelayAccount } from "./account";
import { RelaySignInCancelledError } from "./signIn";

async function confirmConnect(): Promise<boolean> {
  const answer = await showDialog({
    title: "Connect Cloudflare to give your shared projects a relay",
    message: `${RELAY_PURPOSE} LabShelf opens Cloudflare in a new tab, where you sign in and allow it to manage Workers in your account. `
      + "Keep this page open until the tab closes.",
    severity: "info",
    buttons: [{ id: "signIn", label: "Sign In with Cloudflare", primary: true }],
  });
  return answer === "signIn";
}

async function chooseAccount(accounts: CloudflareAccount[]): Promise<string | undefined> {
  return pickQuickEntry(accounts.map((account) => ({ label: account.name, description: account.id, icon: "cloud" as const, value: account.id })), {
    title: "Connect Cloudflare", placeholder: "Account to set up the relay in",
  });
}

async function confirmSignInAgain(): Promise<boolean> {
  const answer = await showDialog({
    title: "Sign in to Cloudflare again",
    message: "Cloudflare no longer accepts the stored sign-in. LabShelf opens Cloudflare in a new tab to sign in again.",
    severity: "info",
    buttons: [{ id: "signIn", label: "Sign In with Cloudflare", primary: true }],
  });
  return answer === "signIn";
}

/** Shows the connected relay's host and offers to rotate or disconnect it; undefined when the owner closes the dialog. */
async function chooseRelayAction(relayUrl: string): Promise<"disconnect" | "rotate" | undefined> {
  const answer = await showDialog({
    title: `Cloudflare is connected, with your relay at ${new URL(relayUrl).host}`,
    message: "Rotate relay moves your shared projects to a new relay and deletes this one after 24 hours. Disconnecting deletes the relay "
      + "from your Cloudflare account, with the encrypted edits it keeps, and takes it out of your shared projects. Shared projects that "
      + "list no other relay stop syncing until someone offers one.",
    severity: "danger",
    buttons: [{ id: "rotate", label: "Rotate relay" }, { id: "disconnect", label: "Disconnect", danger: true }],
  });
  return answer === "disconnect" || answer === "rotate" ? answer : undefined;
}

async function confirmDisconnect(relayUrl: string): Promise<boolean> {
  const answer = await showDialog({
    title: "Disconnect Cloudflare and delete your relay?",
    message: `LabShelf deletes the relay at ${new URL(relayUrl).host} from your Cloudflare account, with the encrypted edits it keeps, and takes it `
      + "out of your shared projects. Shared projects that list no other relay stop syncing until someone offers one.",
    severity: "danger",
    buttons: [{ id: "disconnect", label: "Disconnect", danger: true }],
  });
  return answer === "disconnect";
}

const LOG_MODULE = "relay";

export interface EnsureRelayDeps {
  relay: Pick<BrowserRelayAccount, "account" | "connect">;
  /** Explains the relay and asks whether to connect Cloudflare; false when the owner cancels. */
  confirmConnect(): Promise<boolean>;
  showFailure(message: string): void;
  logger: ILogger;
}

/** Logs a failed relay action and shows it; a sign-in tab the owner closed is only logged. */
function reportRelayFailure(deps: Pick<EnsureRelayDeps, "showFailure" | "logger">, action: string, error: unknown): void {
  if (error instanceof RelaySignInCancelledError) {
    void deps.logger.log("INFO", LOG_MODULE, "Relay action cancelled", { action });
    return;
  }
  void deps.logger.error(LOG_MODULE, error, { action });
  deps.showFailure(`LabShelf could not ${action}: ${formatError(error)}`);
}

/** Resolves the connected account, or undefined when the owner cancels or the connect fails (logged and shown). */
export async function ensureRelay(deps: EnsureRelayDeps): Promise<RelayAccount | undefined> {
  const existing = await deps.relay.account();
  if (existing) { return existing; }
  if (!(await deps.confirmConnect())) {
    await deps.logger.log("INFO", LOG_MODULE, "The owner declined to connect Cloudflare");
    return undefined;
  }
  try {
    const relayUrl = await deps.relay.connect();
    return relayUrl === undefined ? undefined : await deps.relay.account();
  } catch (error) {
    reportRelayFailure(deps, "connect Cloudflare", error);
    return undefined;
  }
}

export interface PageRelayOptions {
  logger: ILogger;
  /** Offers the relay to the shared projects connected on this page. */
  offerToShares(): Promise<void>;
  /** Takes the relay out of the relay lists and stored invites of the shared projects on this page. */
  withdrawFromShares(relayUrl: string): Promise<void>;
}

export interface PageRelay {
  /** Resolves the connected account, or runs the connect after the owner confirms; undefined on cancel or failure. */
  requireBrowserRelay(): Promise<RelayAccount | undefined>;
  /** Connects Cloudflare when it is not connected, otherwise shows the relay and offers to rotate or disconnect it. */
  manage(): Promise<void>;
  /** Moves the shares to a new relay and tells the owner; does nothing when Cloudflare is not connected. */
  rotate(): Promise<void>;
  /** The connected relay's address only; undefined when Cloudflare is not connected. */
  status(): Promise<{ relayUrl: string } | undefined>;
  /** Connects Cloudflare after the owner confirms, and tells the owner; does nothing when it is connected. */
  connect(): Promise<void>;
  /** Disconnects Cloudflare after the owner confirms; does nothing when it is not connected. */
  disconnect(): Promise<void>;
}

/** Moves the shares to a new relay and tells the owner; does nothing when Cloudflare is not connected. */
async function rotateRelay(relay: ReturnType<typeof createBrowserRelayAccount>, deps: EnsureRelayDeps): Promise<void> {
  if (!(await relay.status())) { return; }
  showToast("LabShelf is moving your shares to a new relay. This takes a minute; keep this page open.");
  try {
    const outcome = await relay.rotate();
    if (outcome?.kind === "rotated") {
      showToast(`Your relay moved to ${new URL(outcome.relayUrl).host}. The old one is deleted in 24 hours.`, "ok");
    } else if (outcome?.kind === "pending") {
      showToast(`The previous relay is still running until ${new Date(outcome.retireAfter).toLocaleString()}. Rotate again after that.`);
    }
  } catch (error) {
    reportRelayFailure(deps, "rotate the relay", error);
  }
}

export function createPageRelay(options: PageRelayOptions): PageRelay {
  const { logger } = options;
  const relay = createBrowserRelayAccount({ ...options, chooseAccount, confirmSignInAgain });
  const deps: EnsureRelayDeps = {
    relay, logger,
    confirmConnect: async () => {
      if (!(await confirmConnect())) { return false; }
      showToast("LabShelf sets up your relay once you allow it in the Cloudflare tab. The first time takes up to 4 minutes.");
      return true;
    },
    showFailure: (message) => { showToast(message, "error"); },
  };
  const requireBrowserRelay = (): Promise<RelayAccount | undefined> => ensureRelay(deps);
  const rotate = (): Promise<void> => rotateRelay(relay, deps);
  const disconnect = async (relayUrl: string): Promise<void> => {
    try {
      await relay.disconnect();
      showToast("Cloudflare disconnected, and your relay is deleted.", "ok");
    } catch (error) {
      reportRelayFailure(deps, "disconnect Cloudflare", error);
    }
  };
  const connect = async (): Promise<void> => {
    const account = await requireBrowserRelay();
    if (account) { showToast(`Cloudflare connected, with your relay at ${new URL(account.relayUrl).host}.`, "ok"); }
  };
  return {
    requireBrowserRelay,
    rotate,
    status: () => relay.status(),
    connect: async () => { if (!(await relay.status())) { await connect(); } },
    disconnect: async () => {
      const status = await relay.status();
      if (status && (await confirmDisconnect(status.relayUrl))) { await disconnect(status.relayUrl); }
    },
    manage: async () => {
      const status = await relay.status();
      if (status) {
        const action = await chooseRelayAction(status.relayUrl);
        if (action === "rotate") { return rotate(); }
        return action === "disconnect" ? disconnect(status.relayUrl) : undefined;
      }
      await connect();
    },
  };
}
