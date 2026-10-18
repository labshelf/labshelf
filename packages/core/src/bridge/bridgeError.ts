/** Carries a bridge failure with the protocol error code both sides understand. */
import type { BridgeErrorBody, BridgeErrorCode } from "./protocol.js";

export class BridgeError extends Error {
  constructor(readonly code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
  }

  toBody(): BridgeErrorBody {
    return { code: this.code, message: this.message };
  }
}
