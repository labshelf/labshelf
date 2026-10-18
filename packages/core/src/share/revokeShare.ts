// Revokes one of the device's shares: deletes its manifest, the blobs no other listed share names, then its entry.
import type { ILogger } from "../ports/index.js";
import type { ShareBackend } from "./shareBackend.js";
import { loadShareRegistry, saveShareRegistry, type ShareRegistryStore } from "./shareRegistry.js";

export interface RevokeShareOptions {
  registry: ShareRegistryStore;
  backendFor: (relayUrl: string) => ShareBackend;
  logger: ILogger;
}

// CONTRACT: documents/contracts/share-link.md#upload-and-revoke
/** False when the device lists no such share. A failed delete rejects and keeps the entry, so revoking again finishes. */
export async function revokeShare(shareId: string, { registry, backendFor, logger }: RevokeShareOptions): Promise<boolean> {
  const listed = await loadShareRegistry(registry);
  const record = listed.shares.find((share) => share.id === shareId);
  if (!record) {
    await logger.log("WARN", "share", "Revoke of a share this device does not list", { shareId });
    return false;
  }
  const others = listed.shares.filter((share) => share.id !== shareId);
  const kept = new Set(others.flatMap((share) => share.blobs));
  const doomed = [...new Set(record.blobs)].filter((hash) => !kept.has(hash));
  const backend = backendFor(record.relayUrl);
  try {
    // The manifest goes first: without it the link reads nothing, even while blobs remain.
    await backend.deleteManifest(shareId);
    for (const hash of doomed) { await backend.deleteBlob(shareId, hash); }
  } catch (error) {
    await logger.error("share", error, { shareId, relayUrl: record.relayUrl, action: "revoke" });
    throw error;
  }
  await saveShareRegistry(registry, { shares: others });
  await logger.log("INFO", "share", "Revoked share", { shareId, deletedBlobs: doomed.length, keptBlobs: record.blobs.length - doomed.length });
  return true;
}
