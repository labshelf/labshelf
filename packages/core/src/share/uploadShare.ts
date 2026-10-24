// Publishes a built share to the owner's Worker and lists it on the device, revoking what a failed upload wrote.
import { bytesToBase64Url } from "../encoding/index.js";
import type { ILogger } from "../ports/index.js";
import type { BuiltShare } from "./buildShare.js";
import { formatShareLink } from "./shareLink.js";
import { revokeShare } from "./revokeShare.js";
import type { ShareBackend } from "./shareBackend.js";
import { updateShareRegistry, type ShareRegistryStore } from "./shareRegistry.js";

export interface UploadShareOptions {
  share: BuiltShare;
  relayUrl: string;
  backend: ShareBackend;
  registry: ShareRegistryStore;
  logger: ILogger;
  now?: () => Date;
}

const MODULE = "share";

async function putShare(share: BuiltShare, backend: ShareBackend): Promise<number> {
  let uploaded = 0;
  for (const blob of share.blobs) {
    if (await backend.hasBlob(share.shareId, blob.hash)) { continue; }
    await backend.putBlob(share.shareId, blob.hash, blob.bytes);
    uploaded += 1;
  }
  // INVARIANT: the manifest goes last, so a link never names a blob the Worker lacks.
  await backend.putManifest(share.shareId, share.sealedManifest);
  return uploaded;
}

// CONTRACT: documents/contracts/share-link.md#upload-and-revoke
/** Returns the share link. */
export async function uploadShare({ share, relayUrl, backend, registry, logger, now = () => new Date() }: UploadShareOptions): Promise<string> {
  const record = {
    id: share.shareId, folder: share.manifest.folder, relayUrl, key: bytesToBase64Url(share.key),
    createdAt: now().toISOString(), blobs: share.blobs.map((blob) => blob.hash),
  };
  // The share is listed before anything is uploaded, so whatever reaches the Worker can be revoked.
  await updateShareRegistry(registry, (listed) => ({ shares: [...listed.shares, record] }));
  const context = { shareId: share.shareId, relayUrl, papers: share.manifest.papers.length, blobs: share.blobs.length };
  try {
    const uploaded = await putShare(share, backend);
    await logger.log("INFO", MODULE, "Uploaded share", { ...context, uploaded });
  } catch (error) {
    await logger.error(MODULE, error, { ...context, action: "upload" });
    await revokeShare(share.shareId, { registry, backendFor: () => backend, logger }).catch((cleanup: unknown) =>
      logger.error(MODULE, cleanup, { ...context, action: "revoke after failed upload; the share stays listed" }));
    throw error;
  }
  return formatShareLink({ relayUrl, shareId: share.shareId, key: share.key });
}
