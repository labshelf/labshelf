// Keeps capture drafts (keyed by tab id or search result identity) between the calls that confirm a save.
// Lets the second call reuse the record and the PDF search already run.
import type { ILogger } from "@labshelf/core";
import { createDraftFromSearchHit, detectTabDraft } from "../capture/index";
import type { CaptureDraft } from "../capture/index";
import type { SearchHit } from "../platform";

// PLATFORM: both caches live in memory; a suspended MV3 service worker drops them and the next call rebuilds.
const TTL_MS = 10 * 60_000;
// TRAP: search hits are untrusted page data, so that cache is size-capped as well as TTL-bounded.
const HIT_MAX = 64;

interface Entry {
  url: string;
  at: number;
  draft: Promise<CaptureDraft>;
}

const entries = new Map<number, Entry>();
const hitEntries = new Map<string, { at: number; draft: Promise<CaptureDraft> }>();

/**
 * The tab's draft, inspected once per URL and reused for TTL_MS.
 */
export function readTabDraft(log: ILogger, tabId: number, url: string, fresh = false): Promise<CaptureDraft> {
  const now = Date.now();
  for (const [id, e] of entries) if (now - e.at > TTL_MS) entries.delete(id);
  const hit = entries.get(tabId);
  if (!fresh && hit && hit.url === url) return hit.draft;
  const draft = detectTabDraft(log, tabId, url);
  entries.set(tabId, { url, at: now, draft });
  // A failed inspect must not be served again.
  draft.catch(() => { if (entries.get(tabId)?.draft === draft) entries.delete(tabId); });
  return draft;
}

/** Forgets a tab's draft (closed tab, or a save that changed the library). */
export function removeTabDraft(tabId: number): void {
  entries.delete(tabId);
}

/**
 * A search result's cache key. hit.key falls back to the title, so the links
 * are part of the identity: two results that share a title but link to
 * different papers must not collide.
 */
export function createHitCacheKey(hit: SearchHit): string {
  return JSON.stringify([hit.key, hit.url ?? "", hit.pdfUrl ?? "", hit.title]);
}

/**
 * The search result's draft, built once and reused for TTL_MS, so the
 * "Save without PDF" confirmation reuses the finished search instead of
 * re-fetching the landing page and re-running the whole chain.
 */
export function readHitDraft(log: ILogger, hit: SearchHit): Promise<CaptureDraft> {
  const now = Date.now();
  for (const [k, e] of hitEntries) if (now - e.at > TTL_MS) hitEntries.delete(k);
  const key = createHitCacheKey(hit);
  const cached = hitEntries.get(key);
  if (cached) return cached.draft;
  const draft = createDraftFromSearchHit(log, hit);
  hitEntries.set(key, { at: now, draft });
  // A failed build must not be served again.
  draft.catch(() => { if (hitEntries.get(key)?.draft === draft) hitEntries.delete(key); });
  // Bound the cache: the hit is untrusted page data.
  for (const oldest of hitEntries.keys()) {
    if (hitEntries.size <= HIT_MAX) break;
    hitEntries.delete(oldest);
  }
  return draft;
}

/** Clears the "already in library" mark of drafts pointing at a removed paper. */
export function removePaperDrafts(paperId: string): void {
  const clear = (d: CaptureDraft): void => { if (d.existing?.id === paperId) delete d.existing; };
  for (const entry of entries.values()) {
    void entry.draft.then(clear).catch(() => undefined);
  }
  for (const entry of hitEntries.values()) {
    void entry.draft.then(clear).catch(() => undefined);
  }
}
