// Gives a library page its Cloudflare relay: the account a share asks for, and the connect or disconnect the owner starts.
import type { ILogger, RelayAccount } from "@labshelf/core";
import { toast } from "@labshelf/core/dom";
import { createBrowserRelayAccount } from "../browserRelayAccount";
import { chooseAccount, confirmConnect, confirmDisconnect, confirmSignInAgain } from "./relayDialogs";
import { reportRelayFailure, requireRelay, type RequireRelayDeps } from "./requireRelay";

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
  /** Connects Cloudflare when it is not connected, otherwise shows the relay and offers to disconnect it. */
  manage(): Promise<void>;
}

export function createPageRelay(options: PageRelayOptions): PageRelay {
  const { logger } = options;
  const relay = createBrowserRelayAccount({ ...options, chooseAccount, confirmSignInAgain });
  const deps: RequireRelayDeps = {
    relay, logger,
    confirmConnect: async () => {
      if (!(await confirmConnect())) { return false; }
      toast("LabShelf sets up your relay once you allow it in the Cloudflare tab. The first time takes up to 4 minutes.");
      return true;
    },
    showFailure: (message) => { toast(message, "error"); },
  };
  const requireBrowserRelay = (): Promise<RelayAccount | undefined> => requireRelay(deps);
  const disconnect = async (relayUrl: string): Promise<void> => {
    if (!(await confirmDisconnect(relayUrl))) { return; }
    try {
      await relay.disconnect();
      toast("Cloudflare disconnected, and your relay is deleted.", "ok");
    } catch (error) {
      reportRelayFailure(deps, "disconnect Cloudflare", error);
    }
  };
  return {
    requireBrowserRelay,
    manage: async () => {
      const status = await relay.status();
      if (status) { return disconnect(status.relayUrl); }
      const account = await requireBrowserRelay();
      if (account) { toast(`Cloudflare connected, with your relay at ${new URL(account.relayUrl).host}.`, "ok"); }
    },
  };
}
