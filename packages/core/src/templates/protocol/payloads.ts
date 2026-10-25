/** Declares the data shapes the template gallery protocol carries: a template's key and one source's listing state. All plain JSON. */

import type { PublishCheckId } from "../publishCheckLabels.js";
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

/** The project being published; `engineLabel` names the engine that builds it ("pdfLaTeX"). */
export interface PublishProject {
  id: string;
  title: string;
  engineLabel: string;
}

/** The form values of the Publish screen; the host validates them again before it writes a manifest. */
export interface PublishDraft {
  name: string;
  category: string;
  license: string;
  description: string;
}

/** One check's outcome: `ok` is absent while the check has not finished; `message` explains a failure. */
export interface PublishCheckResult {
  id: PublishCheckId;
  ok?: boolean;
  message?: string;
}
