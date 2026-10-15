/** Reads the bibliographic fields a stored paper record states, in the shape metadata resolution and PDF finding read. */
import { BIBLIOGRAPHIC_FIELDS, type PaperRecord } from "../../model/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";

export function metadataFromRecord(r: PaperRecord): ResolvedMetadata {
  const metadata: ResolvedMetadata = { title: r.title };
  for (const field of BIBLIOGRAPHIC_FIELDS) {
    const value = r[field];
    if (value !== undefined) Object.assign(metadata, { [field]: value });
  }
  return metadata;
}
