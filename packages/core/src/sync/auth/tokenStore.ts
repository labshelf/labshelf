/** The Google token record every app persists, and the port a token store implements. */

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expiry_ms: number;
}

/** Where an app keeps the tokens. The JSON shape of TokenData is a contract: stores share it across app versions. */
export interface TokenStore {
  readonly kind: "keychain" | "secret-service" | "file" | "secret-storage";
  load(): Promise<TokenData | null>;
  save(tokens: TokenData): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Validates stored token JSON.
 * @returns the tokens, or null
 */
export function parseTokens(text: string | undefined | null): TokenData | null {
  if (!text) { return null; }
  try {
    const raw = JSON.parse(text) as Partial<TokenData>;
    if (typeof raw.refresh_token !== "string" || !raw.refresh_token) { return null; }
    return {
      access_token: typeof raw.access_token === "string" ? raw.access_token : "",
      refresh_token: raw.refresh_token,
      expiry_ms: typeof raw.expiry_ms === "number" ? raw.expiry_ms : 0,
    };
  } catch {
    return null;
  }
}
