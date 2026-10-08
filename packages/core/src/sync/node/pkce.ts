/** Random PKCE verifier, its S256 challenge and the OAuth state for one sign-in. */
import * as crypto from "node:crypto";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export interface PkceParams {
  verifier: string;
  challenge: string;
  state: string;
}

export function createPkceParams(): PkceParams {
  const verifier = base64url(crypto.randomBytes(32));
  return {
    verifier,
    challenge: base64url(crypto.createHash("sha256").update(verifier).digest()),
    state: base64url(crypto.randomBytes(16)),
  };
}
