// Compares the helper's protocol version with the page's to decide which side must update.
import type { HelperState, ToPageMessage } from "@labshelf/core/helper";
import type { HelperVersionError } from "./helperConnection";

/** The helper's `v` is all a refusal tells, so a missing or lower one means the helper is older. */
export function statusFromVersionError(error: HelperVersionError, pageProtocol: number): HelperState {
  const protocol = error.helperProtocol;
  if (protocol !== undefined && protocol > pageProtocol) { return { state: "update-extension", protocol }; }
  return { state: "update-helper", protocol: protocol ?? 0, host: undefined };
}

export function statusFromReady(ready: Extract<ToPageMessage, { type: "ready" }>, pageProtocol: number): HelperState {
  if (ready.protocol < pageProtocol) { return { state: "update-helper", protocol: ready.protocol, host: ready.host }; }
  if (ready.protocol > pageProtocol) { return { state: "update-extension", protocol: ready.protocol }; }
  return { state: "ready", helperVersion: ready.helperVersion, tex: ready.tex, host: ready.host };
}
