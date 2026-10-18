// Compares the helper's protocol version with the page's to decide which side must update.
import type { HelperStatus, ToPageMessage } from "@labshelf/core/helper";

export function statusFromReady(ready: Extract<ToPageMessage, { type: "ready" }>, pageProtocol: number): HelperStatus {
  if (ready.protocol < pageProtocol) { return { state: "update-helper", protocol: ready.protocol, host: ready.host }; }
  if (ready.protocol > pageProtocol) { return { state: "update-extension", protocol: ready.protocol }; }
  return { state: "ready", helperVersion: ready.helperVersion, tex: ready.tex, host: ready.host };
}
