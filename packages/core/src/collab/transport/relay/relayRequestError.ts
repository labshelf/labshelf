// Names why a relay refused or failed an HTTP request, so a caller can tell a stale LabShelf from a network blip.

/** `incompatibleRelay` means a Worker of another major; any other code is a relay refusal, `malformed` or `network`. */
export class RelayRequestError extends Error {
  constructor(readonly code: string, readonly status: number, detail: string) {
    super(`Relay request failed (${code}): ${detail}`);
    this.name = "RelayRequestError";
  }
}
