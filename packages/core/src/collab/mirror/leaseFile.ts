// Reads and writes the mirror lease file that marks which app mirrors a project folder.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import type { IFileSystem, ILogger } from "../../ports/index.js";

export const LEASE_TTL_MS = 30_000;
const LEASE_DIR = ".labshelf";
const LEASE_NAME = "mirror-lease.json";
const LOG_MODULE = "collab.ownership";

export type MirrorApp = "vscode" | "browser";

export interface LeaseHolder {
  app: MirrorApp;
  renewedAt: number;
}

export interface LeaseFileContent extends LeaseHolder {
  owner: string;
  ttlMs: number;
}

export function deriveLeasePath(folder: string): string {
  return `${folder.replace(/\/+$/, "")}/${LEASE_DIR}/${LEASE_NAME}`;
}

function parseLease(text: string): LeaseFileContent | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (typeof value !== "object" || value === null) { return undefined; }
  const { owner, app, renewedAt, ttlMs } = value as Record<string, unknown>;
  if (typeof owner !== "string" || owner === "" || (app !== "vscode" && app !== "browser")) { return undefined; }
  if (typeof renewedAt !== "number" || !Number.isFinite(renewedAt)) { return undefined; }
  if (typeof ttlMs !== "number" || !(ttlMs > 0)) { return undefined; }
  return { owner, app, renewedAt, ttlMs };
}

/** The lease in the folder; a missing file is undefined, and a malformed one is undefined with a WARN because it counts as expired. */
export async function readLease(fs: IFileSystem, folder: string, logger: ILogger): Promise<LeaseFileContent | undefined> {
  const file = deriveLeasePath(folder);
  if (!(await fs.exists(file))) { return undefined; }
  const lease = parseLease(await fs.readText(file));
  if (!lease) { await logger.log("WARN", LOG_MODULE, "Treated a malformed mirror lease as expired", { file }); }
  return lease;
}

export async function writeLease(fs: IFileSystem, folder: string, lease: LeaseFileContent): Promise<void> {
  await fs.ensureDir(`${folder.replace(/\/+$/, "")}/${LEASE_DIR}`);
  await fs.writeText(deriveLeasePath(folder), JSON.stringify(lease));
}

export function isLive(lease: LeaseFileContent, now: number): boolean {
  return lease.renewedAt + lease.ttlMs > now;
}
