// Reads the build a relay reports at /version and orders builds so the relay is only ever upgraded.
import type { ILogger } from "../../ports/index.js";
import { RELAY_PATH } from "../http/index.js";

/** A Worker build `<major>.<minor>.<patch>`: the protocol version it serves and a counter that grows with every bundle. */
export interface WorkerBuild { major: number; minor: number; patch: number }

const BUILD_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

export function parseWorkerBuild(text: string): WorkerBuild | undefined {
  const match = BUILD_PATTERN.exec(text);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : undefined;
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal; compares major, then minor, then patch. */
export function compareWorkerBuilds(a: WorkerBuild, b: WorkerBuild): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Reads the public /version of a relay; throws with context when it does not answer a build. */
export async function fetchWorkerBuild(relayUrl: string, doFetch: typeof fetch, logger: ILogger): Promise<WorkerBuild> {
  const url = `${relayUrl.replace(/\/+$/, "")}${RELAY_PATH.version}`;
  try {
    const response = await doFetch(url, { method: "GET" });
    if (!response.ok) { throw new Error(`status ${response.status}`); }
    const body: unknown = await response.json();
    const worker = typeof body === "object" && body !== null ? (body as { worker?: unknown }).worker : undefined;
    const build = typeof worker === "string" ? parseWorkerBuild(worker) : undefined;
    if (!build) { throw new Error("the answer has no valid worker build"); }
    return build;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await logger.log("WARN", "relay.deploy", "Relay /version unreadable", { url, error: reason });
    throw new Error(`Could not read the relay's version at ${url}: ${reason}`, { cause: error });
  }
}

export const formatWorkerBuild = (build: WorkerBuild): string => `${build.major}.${build.minor}.${build.patch}`;
