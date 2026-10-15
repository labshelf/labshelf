/** Declares the record shape every registry client returns. */
import type { ResolvedMetadata } from "../metadata/index.js";

/** A registry record plus the kind of work it describes. */
export interface RegistryRecord extends ResolvedMetadata {
  // CrossRef mints separate DOIs for a paper's abstract, figures and tables.
  // Those records carry the wrong title, so callers must be able to skip them.
  isComponent?: boolean;
}
