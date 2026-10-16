/** Declares the data shapes the template gallery protocol carries: a template's key and one source's listing state. All plain JSON. */

import type { TemplateEntry, TemplateSourceId } from "../templateEntry.js";

/** Names one template across sources: ids are unique only within a source. */
export interface TemplateKey {
  source: TemplateSourceId;
  id: string;
}

/** What the gallery knows of one source: still listing, listed (from the device cache when offline), or failed. */
export type SourceListing =
  | { status: "loading" }
  | { status: "ready"; entries: TemplateEntry[]; fromCache: boolean }
  | { status: "error"; message: string };
