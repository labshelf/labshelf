// Classifies a failure to reach the library folder through the bridge into the reason the UI shows.
import { BridgeError } from "@labshelf/core";
import { isHostNotFound } from "../../platform";
import { BridgeClosedError } from "./bridgeConnection";

export type BridgeFailureReason = "not-installed" | "protocol-mismatch" | "no-library" | "failed";

export interface BridgeFailure {
  reason: BridgeFailureReason;
  detail?: string;
}

export function classifyBridgeFailure(error: unknown): BridgeFailure {
  if (error instanceof BridgeClosedError && isHostNotFound(error.reason)) return { reason: "not-installed" };
  if (error instanceof BridgeError && error.code === "protocol") return { reason: "protocol-mismatch", detail: error.message };
  if (error instanceof BridgeError && error.code === "noLibrary") return { reason: "no-library", detail: error.message };
  return { reason: "failed", detail: error instanceof Error ? error.message : String(error) };
}
