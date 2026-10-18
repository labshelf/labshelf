// Carries the helper protocol error code a project operation is refused with.
export type HelperProjectErrorCode = "path" | "project-id" | "stale" | "limit" | "io" | "no-library";

export class HelperProjectError extends Error {
  constructor(readonly code: HelperProjectErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HelperProjectError";
  }
}
