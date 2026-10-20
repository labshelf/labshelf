// Decides what a share gets when it asks for the owner's relay: the connected account, or a connect the owner confirms first.
import { errorMessage, type ILogger, type RelayAccount } from "@labshelf/core";
import type { BrowserRelayAccount } from "../browserRelayAccount";
import { RelaySignInCancelledError } from "../watchRedirectTab";

const LOG_MODULE = "relay";

export interface RequireRelayDeps {
  relay: Pick<BrowserRelayAccount, "account" | "connect">;
  /** Explains the relay and asks whether to connect Cloudflare; false when the owner cancels. */
  confirmConnect(): Promise<boolean>;
  showFailure(message: string): void;
  logger: ILogger;
}

/** Logs a failed relay action and shows it; a sign-in tab the owner closed is only logged. */
export function reportRelayFailure(deps: Pick<RequireRelayDeps, "showFailure" | "logger">, action: string, error: unknown): void {
  if (error instanceof RelaySignInCancelledError) {
    void deps.logger.log("INFO", LOG_MODULE, "Relay action cancelled", { action });
    return;
  }
  void deps.logger.error(LOG_MODULE, error, { action });
  deps.showFailure(`LabShelf could not ${action}: ${errorMessage(error)}`);
}

/** Resolves the connected account, or undefined when the owner cancels or the connect fails (logged and shown). */
export async function requireRelay(deps: RequireRelayDeps): Promise<RelayAccount | undefined> {
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
