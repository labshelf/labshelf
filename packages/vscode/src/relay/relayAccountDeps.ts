// Gives the core relay account flows their VS Code ports: the stored connection, fetch, the clock and the sign-in prompt.
import * as vscode from "vscode";

import { systemRelayClock, type RelayAccountDeps } from "@labshelf/core";
import type { RelayDeps } from "./connectRelay.js";
import { signInToCloudflare } from "./signIn/index.js";

export function relayAccountDeps(deps: RelayDeps): RelayAccountDeps {
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
