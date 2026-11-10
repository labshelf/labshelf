/** The Remote access switch: turning on sends the owner email to the relay, registers the directory row when it is missing
 * and runs the first sync; turning off deletes the Mirror's rows on the relay and the device's hash table. The persisted
 * on/off flag lives in the app. */
import type { MirrorRelay } from "./mirrorRelay.js";
import type { MirrorRunResult } from "./mirrorRunner.js";
import type { MirrorStateStore } from "./mirrorState.js";

export type RemoteAccessResult = { ok: true } | { ok: false; reason: "needs_sign_in" | "no_relay" | "failed"; message: string }

const SIGN_IN_MESSAGE = "Remote access needs Cloudflare sign-in";

function reasonOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createRemoteAccess(deps: { readEmail(): Promise<string | undefined>; relay: MirrorRelay; directory: { self(): Promise<string | undefined>; register(): Promise<void> }; runner: { run(): Promise<MirrorRunResult> }; state: MirrorStateStore }): { turnOn(): Promise<RemoteAccessResult>; turnOff(): Promise<RemoteAccessResult> } {
  async function turnOn(): Promise<RemoteAccessResult> {
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

  async function turnOff(): Promise<RemoteAccessResult> {
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

  return { turnOn, turnOff };
}
