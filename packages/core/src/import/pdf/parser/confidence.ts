/** Grades how far the parser trusts the record it produced. */
import type { MetadataConfidence, ResolvedMetadata } from "../../metadata/index.js";

export function gradeConfidence(
  identifierConfirmed: boolean,
  resolvedOnline: boolean,
  metadata: ResolvedMetadata,
): MetadataConfidence {
  if (identifierConfirmed) {
    return "high";
  }
  if (resolvedOnline) {
    return "medium";
  }
  return metadata.title ? "medium" : "low";
}
