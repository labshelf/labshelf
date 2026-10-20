// Brings the owner's deployed relay up to the Worker build this LabShelf bundles, once per start.
import { relayWorkerScript, updateOwnRelay } from "@labshelf/core";
import type { RelayDeps } from "./connectRelay.js";
import { relayAccountDeps } from "./relayAccountDeps.js";
import { reportRelayFailure } from "./relayFailure.js";

export async function updateRelayOnStart(deps: RelayDeps): Promise<void> {
  try {
    await updateOwnRelay({ ...relayAccountDeps(deps), script: relayWorkerScript() });
  } catch (error) {
    reportRelayFailure(deps.logger, "update your relay", error);
  }
}
