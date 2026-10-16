/** Describes one template as the gallery lists it, whichever source it comes from. */

import type { TemplateManifest } from "./templateManifest.js";

export const TEMPLATE_SOURCES = ["community", "universe", "mine"] as const;
export type TemplateSourceId = (typeof TEMPLATE_SOURCES)[number];

export interface TemplateEntry extends TemplateManifest {
  source: TemplateSourceId;
  /** The package version, for Typst Universe templates. */
  version?: string;
}
