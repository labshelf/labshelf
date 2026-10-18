// Names why the Worker refused or failed a share request, so the app can tell a wrong secret from a network blip.

/** `code` is a relay refusal code, `incompatibleRelay`, `malformed` for an unreadable answer, or `network`. */
export class ShareRequestError extends Error {
  constructor(readonly code: string, readonly status: number, detail: string) {
    super(`Share request failed (${code}): ${detail}`);
    this.name = "ShareRequestError";
  }
}
