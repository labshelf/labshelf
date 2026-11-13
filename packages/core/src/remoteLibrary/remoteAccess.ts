/** The Remote access switch and settings: turning on sends the owner email to the relay, registers the directory row when
 * it is missing and runs the first sync; turning off deletes the Mirror's rows on the relay and the device's hash table.
 * The settings (paper PDFs, limit, store) go to the Mirror and are followed by a sync. The on/off flag lives in the app. */
import { MirrorRefusal, type MirrorRelay, type MirrorSettings, type MirrorStatus, type MirrorStore } from "./mirrorRelay.js";
import type { MirrorRunResult } from "./mirrorRunner.js";
import { estimatePaperPdfs, type MirrorSelectionDeps } from "./mirrorSelection.js";
import type { MirrorStateStore } from "./mirrorState.js";

export type RemoteAccessResult = { ok: true } | { ok: false; reason: "needs_sign_in" | "no_relay" | "no_bucket" | "failed"; message: string }

export interface RemoteAccessDeps {
  readEmail(): Promise<string | undefined>;
  relay: MirrorRelay;
  directory: { self(): Promise<string | undefined>; register(): Promise<void> };
  runner: { run(): Promise<MirrorRunResult> };
  state: MirrorStateStore;
  /** The same deps the runner's selection reads, for the paper PDF estimate. */
  selection(): Promise<MirrorSelectionDeps>;
}

export interface RemoteAccess {
  turnOn(): Promise<RemoteAccessResult>;
  turnOff(): Promise<RemoteAccessResult>;
  status(): Promise<MirrorStatus>;
  setIncludePdfs(on: boolean): Promise<RemoteAccessResult>;
  /** Bytes, or null for the store's default. */
  setLimit(limit: number | null): Promise<RemoteAccessResult>;
  /** Clears the Mirror into the other store and uploads the library again. */
  moveStore(store: MirrorStore): Promise<RemoteAccessResult>;
  estimatePaperPdfs(): Promise<{ bytes: number; files: number }>;
}

const SIGN_IN_MESSAGE = "Remote access needs Cloudflare sign-in";
const NO_BUCKET_MESSAGE = "Create the R2 bucket labshelf-mirror first (R2 needs a card on your Cloudflare account).";
const MALFORMED_LIMIT_MESSAGE = "The Durable Object store holds at most 5 GB.";

function reasonOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function turnOn(deps: RemoteAccessDeps): Promise<RemoteAccessResult> {
  let email: string | undefined;
  try {
    email = await deps.readEmail();
  } catch (error) {
    return { ok: false, reason: "failed", message: reasonOf(error, "Remote access could not read your Cloudflare account.") };
  }
  if (!email) { return { ok: false, reason: "needs_sign_in", message: SIGN_IN_MESSAGE }; }

  try {
    await deps.relay.putOwner(email);
  } catch (error) {
    return { ok: false, reason: "no_relay", message: `Remote access could not reach your relay: ${reasonOf(error, "the owner email was not saved.")}` };
  }
  try {
    if (await deps.directory.self() === undefined) { await deps.directory.register(); }
    await deps.runner.run();
  } catch (error) {
    return { ok: false, reason: "failed", message: reasonOf(error, "Remote access could not be turned on.") };
  }
  return { ok: true };
}

async function turnOff(deps: RemoteAccessDeps): Promise<RemoteAccessResult> {
  try {
    await deps.relay.clear();
  } catch (error) {
    return { ok: false, reason: "no_relay", message: `Remote access could not reach your relay: ${reasonOf(error, "the Mirror was not cleared.")}` };
  }
  try {
    await deps.state.clear();
  } catch (error) {
    return { ok: false, reason: "failed", message: reasonOf(error, "Remote access could not be turned off.") };
  }
  return { ok: true };
}

/** Saves the settings, then (a store move) drops the device table, then syncs; a refusal answers before anything else runs. */
async function change(deps: RemoteAccessDeps, settings: MirrorSettings, clearTable: boolean): Promise<RemoteAccessResult> {
  try {
    await deps.relay.setSettings(settings);
  } catch (error) {
    if (error instanceof MirrorRefusal && error.code === "noBucket") { return { ok: false, reason: "no_bucket", message: NO_BUCKET_MESSAGE }; }
    if (error instanceof MirrorRefusal && error.code === "malformed") { return { ok: false, reason: "failed", message: MALFORMED_LIMIT_MESSAGE }; }
    return { ok: false, reason: "no_relay", message: `Remote access could not reach your relay: ${reasonOf(error, "the setting was not saved.")}` };
  }
  try {
    if (clearTable) { await deps.state.clear(); }
    await deps.runner.run();
  } catch (error) {
    return { ok: false, reason: "failed", message: reasonOf(error, "The remote library could not be synced.") };
  }
  return { ok: true };
}

export function createRemoteAccess(deps: RemoteAccessDeps): RemoteAccess {
  return {
    turnOn: () => turnOn(deps),
    turnOff: () => turnOff(deps),
    status: () => deps.relay.status(),
    setIncludePdfs: (on) => change(deps, { includePdfs: on }, false),
    setLimit: (limit) => change(deps, { limit }, false),
    moveStore: (store) => change(deps, { store }, true),
    estimatePaperPdfs: async () => estimatePaperPdfs(await deps.selection()),
  };
}
