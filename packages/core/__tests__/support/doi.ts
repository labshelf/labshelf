/** Builds a branded DOI for a test fixture, failing loudly when the fixture text is not DOI-shaped. */
import { toDoi, type Doi } from "@labshelf/core";

export function doiOf(text: string): Doi {
  const doi = toDoi(text);
  if (!doi) throw new Error(`Not a DOI: ${text}`);
  return doi;
}
