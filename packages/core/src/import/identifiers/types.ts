/** Shapes shared by every identifier detector: the kinds of identifier and the ids found on a page. */

export type IdentifierType = "doi" | "arxiv" | "pmid" | "pmcid" | "isbn";

export interface DetectedIdentifier {
  type: IdentifierType;
  value: string;
}

/** The identifiers a web page or library record names, one per kind. */
export interface DetectedIds {
  doi?: string;
  arxivId?: string;
  pmid?: string;
}
