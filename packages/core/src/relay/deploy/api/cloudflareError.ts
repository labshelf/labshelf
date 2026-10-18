// Carries a failed Cloudflare API call with its status, error code and a message a user can act on.

const AUTH_CODES = new Set([1000, 6003, 6111, 10000]);

export class CloudflareApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    /** HTTP status, or 0 when Cloudflare could not be reached. */
    readonly status: number,
    /** The first `errors[].code` of the response, or 0 when there is none. */
    readonly code: number,
    readonly cloudflareMessage: string,
  ) {
    super(describe(method, path, status, code, cloudflareMessage));
    this.name = "CloudflareApiError";
  }
}

function describe(method: string, path: string, status: number, code: number, message: string): string {
  if (status === 0) { return `Could not reach Cloudflare (${method} ${path}): ${message}`; }
  if (status === 401 || AUTH_CODES.has(code)) {
    return `Cloudflare rejected the API token (${message}). Create it again from the LabShelf template and paste it whole.`;
  }
  if (code === 10063) { return "The account has no workers.dev subdomain, so the relay cannot get an address."; }
  if (status === 403) {
    return `The API token lacks a permission for ${method} ${path} (${message}). Create it again from the LabShelf template.`;
  }
  return `Cloudflare failed ${method} ${path} (status ${status}, code ${code}): ${message}`;
}
