// Describes why a blob could not be fetched from the peers of a share.

export type BlobFetchErrorCode = "unavailable" | "corrupt" | "invalidHash" | "closed";

export class BlobFetchError extends Error {
  constructor(readonly code: BlobFetchErrorCode, readonly hash: string) {
    super(`Blob ${hash} could not be fetched: ${code}`);
    this.name = "BlobFetchError";
  }
}
