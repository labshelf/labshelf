// Rotates the owner's relay on the desktop: the Rotate Relay command, the hourly abuse check while a share is open and the retirement of a rotated-out relay.
import * as vscode from "vscode";

import {
  createCloudflareAbuseSignal,
  createRelayProbe,
  readRelayWorkerScript,
  retireRelayIfDue,
  rotateRelay,
  rotateRelayOnAbuse,
  type RelayLock,
  type RelayRotationOutcome,
  type RotateRelayDeps,
} from "@labshelf/core";
import { createLazyProgress } from "./accounts.js";
import { createRelayAccountDeps, reportRelayFailure, type ConnectDeps } from "./connect.js";

export const ROTATE_RELAY_COMMAND = "labshelf.relay.rotate";
/** The abuse check and the retirement run at most this often. */
export const RELAY_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface RotateDeps extends ConnectDeps {
  /** Takes the relay out of the relay lists and stored invites of the shared projects on this device. */
  withdrawFromShares(relayUrl: string): Promise<void>;
  /** Runs a relay change while holding the lock every window shares. */
  withLock: RelayLock;
  /** True while a share is open in this window. */
  hasOpenShare(): boolean;
  /** Moves the directory registration and the cards to the new relay (the invitations' `updateAfterRotation`). */
  updateRegistration?(change: { previousUrl: string; relayUrl: string }): Promise<void>;
}

const PROGRESS_STEPS = {
  deploying: "Deploying the new relay",
  waiting: "Waiting for the new relay to answer",
  offering: "Offering the new relay to your shared projects",
  withdrawing: "Moving your shared projects off the old relay",
} as const;

function createRotationDeps(deps: RotateDeps, progress?: (step: keyof typeof PROGRESS_STEPS) => void): RotateRelayDeps {
  return {
    ...createRelayAccountDeps(deps),
    withLock: deps.withLock,
    script: readRelayWorkerScript(),
    offerToShares: deps.offerToShares,
    withdrawFromShares: deps.withdrawFromShares,
    ...(deps.updateRegistration ? { updateRegistration: deps.updateRegistration } : {}),
    ...(progress ? { progress } : {}),
  };
}

function describeOutcome(outcome: RelayRotationOutcome | undefined): string {
  if (!outcome) { return "Cloudflare is not connected."; }
  if (outcome.kind === "pending") {
    return `Your relay was rotated recently. The previous one is deleted on ${new Date(outcome.retireAfter).toLocaleString()}; rotate again after that.`;
  }
  return "Your relay has a new address, and your shared projects moved to it. The old relay is deleted after a day.";
}

async function rotateFromCommand(deps: RotateDeps): Promise<void> {
  try {
    const progress = createLazyProgress("Rotating your relay");
    let outcome: RelayRotationOutcome | undefined;
    try {
      outcome = await rotateRelay(createRotationDeps(deps, (step) => progress.report(PROGRESS_STEPS[step])));
    } finally {
      progress.close();
    }
    void vscode.window.showInformationMessage(describeOutcome(outcome));
  } catch (error) {
    reportRelayFailure(deps.logger, "rotate your relay", error);
  }
}

/** Deletes the relay a rotation replaced once its grace period has passed. */
export async function retireRotatedOutRelay(deps: RotateDeps): Promise<void> {
  try {
    await retireRelayIfDue({ ...createRelayAccountDeps(deps), withLock: deps.withLock });
  } catch (error) {
    reportRelayFailure(deps.logger, "delete your previous relay", error);
  }
}

/** Rotates the relay when its traffic or a refusal by Cloudflare's limit calls for it; does nothing while no share is open. */
async function checkRelayAbuse(deps: RotateDeps): Promise<void> {
  if (!deps.hasOpenShare()) { return; }
  try {
    const account = await deps.accounts.get();
    if (!account) { return; }
    const rotationDeps = createRotationDeps(deps);
    const limitRefused = (await createRelayProbe({ logger: deps.logger })(account.relayUrl)) === "limit";
    const outcome = await rotateRelayOnAbuse({ ...rotationDeps, signal: createCloudflareAbuseSignal(rotationDeps), limitRefused });
    if (outcome?.kind === "rotated") {
      void vscode.window.showWarningMessage("LabShelf moved your shared projects to a new relay because the old one was close to Cloudflare's daily limit.");
    }
  } catch (error) {
    reportRelayFailure(deps.logger, "check your relay's traffic", error);
  }
}

/** One hourly tick: retires a relay past its grace period, then checks for abuse. */
async function runRelayCheck(deps: RotateDeps): Promise<void> {
  await retireRotatedOutRelay(deps);
  await checkRelayAbuse(deps);
}

/** Registers the Rotate Relay command and the hourly check, both disposed with the extension. */
export function registerRotation(context: vscode.ExtensionContext, deps: RotateDeps): void {
  const timer = setInterval(() => { void runRelayCheck(deps); }, RELAY_CHECK_INTERVAL_MS);
  context.subscriptions.push(
    vscode.commands.registerCommand(ROTATE_RELAY_COMMAND, () => rotateFromCommand(deps)),
    { dispose: () => clearInterval(timer) },
  );
}
