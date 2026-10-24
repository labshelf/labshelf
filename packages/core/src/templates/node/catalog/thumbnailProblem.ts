/** Checks that thumbnail bytes are a PNG whose width fits the catalog limits. */
// CONTRACT: documents/contracts/templates.md#manifest

import { THUMBNAIL_MAX_WIDTH, THUMBNAIL_MIN_WIDTH } from "./catalogLimits.js";
import { readPngWidth } from "./pngWidth.js";

/** The reason the bytes cannot be a catalog thumbnail, or undefined when the width fits. */
export function thumbnailProblem(bytes: Uint8Array): string | undefined {
  const width = readPngWidth(bytes);
  if (width === undefined) { return "thumbnail.png is not a PNG"; }
  const inRange = width >= THUMBNAIL_MIN_WIDTH && width <= THUMBNAIL_MAX_WIDTH;
  return inRange ? undefined : `thumbnail.png is ${width} pixels wide, not ${THUMBNAIL_MIN_WIDTH} to ${THUMBNAIL_MAX_WIDTH}`;
}
