/** Declares the shapes every identifier detector shares: the kinds of identifier and the ids found on a page. */

import type { Doi } from "./doi.js";

export type IdentifierType = "doi" | "arxiv" | "pmid" | "pmcid" | "isbn";

export type DetectedIdentifier = { type: "doi"; value: Doi } | { type: Exclude<IdentifierType, "doi">; value: string };

/** The identifiers a web page or library record names, one per kind. */
export interface DetectedIds {
  doi?: Doi;
  arxivId?: string;
  pmid?: string;
}
