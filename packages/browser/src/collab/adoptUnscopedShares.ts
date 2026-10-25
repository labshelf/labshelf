// Moves share keys stored without a library under the library whose projects hold their share ids.
// Delete when no installed extension can still hold a `collabShares.shares` record, which only versions that kept shares without library ids wrote.
import { isRecord, libraryShares, readSharesRecord, toShare, withLibraryShares, writeSharesRecord } from "./storedShareKeys";

/**
 * `shareIds` are the share ids of projects in the library's folder; an unscoped entry no project of this library holds stays
 * for the library that does. TRAP: never pass a share id only because its tab is open, since the tab may name another library's project.
 */
export async function adoptUnscopedShares(libraryId: string, shareIds: Iterable<string>): Promise<void> {
  const record = await readSharesRecord();
  if (!isRecord(record["shares"])) return;
  const unscoped = { ...record["shares"] };
  const scoped = { ...libraryShares(record, libraryId) };
  let moved = false;
  for (const shareId of shareIds) {
    // A malformed entry stays where it is, so nothing that might still be read is lost.
    if (toShare(unscoped[shareId]) === undefined) continue;
    scoped[shareId] ??= unscoped[shareId];
    delete unscoped[shareId];
    moved = true;
  }
  if (!moved) return;
  const next: Record<string, unknown> = { ...record, shares: unscoped };
  if (Object.keys(unscoped).length === 0) delete next["shares"];
  await writeSharesRecord(withLibraryShares(next, libraryId, scoped));
}
