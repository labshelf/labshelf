/** Declares the metadata record every source (registry, XMP, PDF text) produces, and how far the parser trusts it. */

export interface ResolvedMetadata {
  title?: string | undefined;
  authors?: string[] | undefined;
  year?: number | undefined;
  journal?: string | undefined;
  publisher?: string | undefined;
  volume?: string | undefined;
  issue?: string | undefined;
  pages?: string | undefined;
  doi?: string | undefined;
  url?: string | undefined;
  issn?: string | undefined;
  language?: string | undefined;
  summary?: string | undefined;
  keywords?: string[] | undefined;
}

/**
 * How much the parser trusts the record it produced.
 * - `high`: confirmed against a registry via an identifier printed in the PDF.
 * - `medium`: matched online by text, or taken from an embedded XMP packet.
 * - `low`: inferred from layout or the filename; needs a human to confirm.
 */
export type MetadataConfidence = "high" | "medium" | "low";
