/** Maps any failure in the host to the bridge error code the browser acts on. */
import { BridgeError } from "../bridgeError.js";

export function toBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  const code = (error as NodeJS.ErrnoException).code;
  const message = error instanceof Error ? error.message : String(error);
  return new BridgeError(code === "ENOENT" ? "notFound" : "io", message);
}
