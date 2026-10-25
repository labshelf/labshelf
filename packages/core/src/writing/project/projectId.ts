/** Derives a readable project id from a title; the id is also the project's folder name under projects/. */

import { normalizeText } from "../../library/index.js";

/** "Deep Nets: a Survey" → "deep-nets-a-survey"; "project" when the title has no letters or digits. */
export function projectIdSlug(title: string): string {
  return normalizeText(title).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}
