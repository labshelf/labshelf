// Checks that a host reply has the result shape the contract gives for the op that asked for it.
import { BridgeError } from "@labshelf/core";

type Result = Record<string, unknown>;

const STAT_FIELDS = { isFile: "boolean", isDirectory: "boolean", mtimeMs: "number", size: "number" } as const;

const isStat = (value: unknown): boolean => value === null
  || (typeof value === "object" && Object.entries(STAT_FIELDS).every(([key, type]) => typeof (value as Result)[key] === type));

// CONTRACT: documents/contracts/bridge.md#messages
const SHAPES: Partial<Record<string, (result: Result) => boolean>> = {
  hello: (r) => typeof r.protocol === "number" && typeof r.libraryRoot === "string" && typeof r.paperCount === "number",
  setLibrary: (r) => typeof r.libraryRoot === "string" && typeof r.paperCount === "number",
  listDir: (r) => Array.isArray(r.names) && r.names.every((name) => typeof name === "string"),
  stat: (r) => isStat(r.stat),
  readFile: (r) => r.done === true && typeof r.size === "number",
};

/** Returns the result when it fits `op`; an op without a listed shape needs only an object. */
export function checkReply(op: string, result: unknown): Result {
  const fits = typeof result === "object" && result !== null && (SHAPES[op]?.(result as Result) ?? true);
  if (!fits) throw new BridgeError("protocol", `The bridge answered ${op} with a malformed result: ${JSON.stringify(result)?.slice(0, 200)}`);
  return result as Result;
}
