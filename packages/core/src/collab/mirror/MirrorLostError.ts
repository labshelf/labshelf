// Signals that another mirror took a folder's lease, so this mirror must stop writing to disk.
import type { LeaseHolder } from "./leaseFile.js";

export class MirrorLostError extends Error {
  constructor(readonly folder: string, readonly holder: LeaseHolder) {
    super(`The mirror of ${folder} is owned by ${holder.app} (renewed at ${new Date(holder.renewedAt).toISOString()})`);
    this.name = "MirrorLostError";
  }
}
