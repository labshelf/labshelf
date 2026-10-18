/** Validates untrusted bridge requests and protocol versions before either side acts on them. */
import { BridgeError } from "./bridgeError.js";
import { BRIDGE_PROTOCOL, type BridgeRequest } from "./protocol.js";

const PATH_OPS = new Set(["listDir", "stat", "readFile", "writeFile", "deleteFile", "ensureDir"]);

const refuse = (message: string): never => { throw new BridgeError("protocol", message); };

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field : refuse(`Op "${String(value["op"])}" needs a string "${key}"`);
}

/** @returns the request id when the message has a usable one, so a refusal can still name it */
export function requestId(value: unknown): number | null {
  const id = typeof value === "object" && value !== null ? (value as Record<string, unknown>)["id"] : undefined;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}

// CONTRACT: documents/contracts/bridge.md#messages
export function parseBridgeRequest(value: unknown): BridgeRequest {
  const id = requestId(value);
  if (id === null) return refuse("Request needs an integer id");
  const message = value as Record<string, unknown>;
  const op = message["op"];
  if (typeof op === "string" && PATH_OPS.has(op)) {
    return { id, op: op as "stat", path: stringField(message, "path") };
  }
  switch (op) {
    case "hello": {
      const protocol = message["protocol"];
      return { id, op, protocol: typeof protocol === "number" ? protocol : refuse("Op \"hello\" needs a number \"protocol\"") };
    }
    case "rename": return { id, op, from: stringField(message, "from"), to: stringField(message, "to") };
    case "chunk": return { id, op, data: stringField(message, "data") };
    case "commit": {
      const size = message["size"];
      const valid = typeof size === "number" && Number.isSafeInteger(size) && size >= 0;
      return { id, op, size: valid ? size : refuse("Op \"commit\" needs a non-negative integer \"size\"") };
    }
    default: return refuse(`Unknown op "${String(op)}"`);
  }
}

// CONTRACT: documents/contracts/bridge.md#versioning
export function assertSameProtocol(remote: unknown): void {
  if (remote === BRIDGE_PROTOCOL) return;
  throw new BridgeError(
    "protocol",
    `This side speaks bridge protocol ${BRIDGE_PROTOCOL}, the other side speaks ${String(remote)}. `
      + "Update LabShelf in the browser and on the desktop to the same release.",
  );
}
