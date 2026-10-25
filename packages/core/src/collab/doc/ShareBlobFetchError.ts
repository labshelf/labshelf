// Describes why a blob could not be fetched from the peers of a share.

export type ShareBlobFetchErrorCode = "unavailable" | "corrupt" | "invalidHash" | "closed";

export class ShareBlobFetchError extends Error {
  constructor(readonly code: ShareBlobFetchErrorCode, readonly hash: string) {
    super(`Blob ${hash} could not be fetched: ${code}`);
    this.name = "BlobFetchError";
  }
}
