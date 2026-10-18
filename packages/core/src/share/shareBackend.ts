// Declares the ports through which shares reach the owner's Worker: owner writes, and the public reads of the share page.

// CONTRACT: documents/contracts/share-link.md#worker-endpoints
export interface ShareBackend {
  putManifest(shareId: string, bytes: Uint8Array): Promise<void>;
  putBlob(shareId: string, hash: string, bytes: Uint8Array): Promise<void>;
  hasBlob(shareId: string, hash: string): Promise<boolean>;
  /** Succeeds also when nothing is stored, so a revoke can repeat. */
  deleteManifest(shareId: string): Promise<void>;
  deleteBlob(shareId: string, hash: string): Promise<void>;
}

/** Undefined means the Worker holds no such manifest or blob; any other failure rejects. */
export interface ShareReader {
  fetchManifest(shareId: string): Promise<Uint8Array | undefined>;
  fetchBlob(shareId: string, hash: string): Promise<Uint8Array | undefined>;
}
