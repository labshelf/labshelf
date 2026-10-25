// Keeps the key and relay list of each share per library, and the member's display name, in extension storage.
import { base64UrlToBytes, bytesToBase64Url, type ShareKeyStore, type StoredInvite } from "@labshelf/core";
import { adoptUnscopedShares } from "./adoptUnscopedShares";
import { libraryShares, readSharesRecord, toShare, withLibraryShares, writeSharesRecord } from "./storedShareKeys";

/** `libraryId` names the library open at the time of each call; the user can switch libraries while the page is open. */
export function createShareKeyStore(libraryId: () => Promise<string>): ShareKeyStore {
  const update = async (change: (shares: Record<string, unknown>) => void): Promise<void> => {
    const library = await libraryId();
    const record = await readSharesRecord();
    const shares = { ...libraryShares(record, library) };
    change(shares);
    await writeSharesRecord(withLibraryShares(record, library, shares));
  };
  return {
    remember: ({ shareId, shareKey, relays }) => update((shares) => { shares[shareId] = { key: bytesToBase64Url(shareKey), relays }; }),
    forget: (shareId) => update((shares) => { delete shares[shareId]; }),
    invite: async (shareId) => {
      const library = await libraryId();
      // INVARIANT: the share workflows ask only for share ids of this library's projects or connections, which the migration needs.
      await adoptUnscopedShares(library, [shareId]);
      const share = toShare(libraryShares(await readSharesRecord(), library)[shareId]);
      return share === undefined ? undefined : decoded(shareId, share);
    },
  };
}

function decoded(shareId: string, share: { key: string; relays: StoredInvite["relays"] }): StoredInvite | undefined {
  try {
    return { shareId, shareKey: base64UrlToBytes(share.key), relays: share.relays };
  } catch {
    // A key that does not decode is no usable key, which is what `undefined` reports; the entry stays for inspection.
    return undefined;
  }
}

export async function saveDisplayName(name: string): Promise<void> {
  await writeSharesRecord({ ...(await readSharesRecord()), displayName: name });
}

export async function loadDisplayName(): Promise<string | undefined> {
  const name = (await readSharesRecord())["displayName"];
  return typeof name === "string" ? name : undefined;
}
