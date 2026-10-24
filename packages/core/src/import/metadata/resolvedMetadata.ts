/** Declares the metadata record every source (registry, XMP, PDF text) produces, and how far the parser trusts it. */
import type { BibliographicFields } from "../../model/index.js";

export interface ResolvedMetadata extends BibliographicFields {
  title?: string | undefined;
}

/**
 * How much the parser trusts the record it produced.
 * - `high`: confirmed against a registry via an identifier printed in the PDF.
 * - `medium`: matched online by text, or taken from an embedded XMP packet.
 * - `low`: inferred from layout or the filename; needs a human to confirm.
 */
export type MetadataConfidence = "high" | "medium" | "low";
