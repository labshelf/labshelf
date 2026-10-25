/** Decides, for each paper a project lists, whether the library has it, holds it under another key, or must import it. */
import { doiLookup } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import { papersByCiteKey } from "../citations/index.js";
import type { ListedPaper } from "./listedPapers.js";

export type InstallEntry =
  | { kind: "present"; key: string }
  /** The library has no paper with this key, but one with the listed DOI, keyed `existingKey`. */
  | { kind: "other-key"; key: string; existingKey: string }
  | { kind: "no-doi"; key: string }
  /** The key becomes the paper's folder name, so it must be a plain name. */
  | { kind: "bad-key"; key: string }
  | { kind: "import"; key: string; doi: string };

// INVARIANT: a key that passes becomes a folder name inside the library; it can never name a path.
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.+-]*$/;

/** @returns one entry per listed paper, in the listed order; a key listed twice is planned once */
export function planInstall(listed: readonly ListedPaper[], records: readonly PaperRecord[]): InstallEntry[] {
  const byKey = papersByCiteKey(records);
  const byDoi = doiLookup(records);
  const keyOfId = new Map(records.map((record) => [record.id, record.citeKey]));
  const seen = new Set<string>();
  const plan: InstallEntry[] = [];
  for (const { key, doi } of listed) {
    if (seen.has(key)) { continue; }
    seen.add(key);
    if (!SAFE_KEY.test(key)) { plan.push({ kind: "bad-key", key }); continue; }
    if (byKey.has(key)) { plan.push({ kind: "present", key }); continue; }
    if (!doi) { plan.push({ kind: "no-doi", key }); continue; }
    const existingId = byDoi(doi);
    plan.push(existingId ? { kind: "other-key", key, existingKey: keyOfId.get(existingId) ?? existingId } : { kind: "import", key, doi });
  }
  return plan;
}
