// Persists the Google Drive access token and its absolute expiry in `bx.storage.local`.
import { bx } from "../../platform/browserApi";

// TRAP: never `bx.storage.sync`; the token must not leave the local profile. The expiry is stored because the
// implicit flow returns no refresh token.
const STORAGE_KEY = "labshelf.gdrive.token";

export interface StoredToken {
  accessToken: string;
  expiryMs: number;
  scope: string;
}

export async function loadToken(): Promise<StoredToken | null> {
  const stored = await bx.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY];
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<StoredToken>;
  if (typeof t.accessToken !== "string" || typeof t.expiryMs !== "number" || typeof t.scope !== "string") {
    return null;
  }
  return { accessToken: t.accessToken, expiryMs: t.expiryMs, scope: t.scope };
}

export async function saveToken(token: StoredToken): Promise<void> {
  await bx.storage.local.set({ [STORAGE_KEY]: token });
}

export async function clearToken(): Promise<void> {
  await bx.storage.local.remove(STORAGE_KEY);
}
