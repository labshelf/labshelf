// Converts the integer coordinates of a SyncTeX file to PDF points, the way the reference synctex parser does.

// 65536 sp per TeX point, 72.27 TeX points per 72 PDF points.
const SP_PER_POINT = 65781.76;

export interface SyncScale {
  /** Converts a horizontal position. */
  x(raw: number): number;
  /** Converts a vertical position. */
  y(raw: number): number;
  /** Converts a width, height or depth. */
  size(raw: number): number;
}

function headerValue(text: string, key: string): number | undefined {
  const match = new RegExp(`^${key}:\\s*(-?\\d+)`, "m").exec(text);
  return match ? Number(match[1]) : undefined;
}

/**
 * Reads Unit, Magnification and the offsets from the preamble; a post scriptum (added by `synctex update`) overrides them.
 * Magnification scales coordinates and sizes but not the offsets; Unit scales all three. Checked against `synctex view`.
 */
export function readSyncScale(text: string): SyncScale {
  const contentAt = text.indexOf("\nContent:");
  const postAt = text.lastIndexOf("\nPost scriptum:");
  const header = contentAt === -1 ? text : text.slice(0, contentAt);
  const post = postAt === -1 ? "" : text.slice(postAt);
  const read = (key: string): number | undefined => headerValue(post, key) ?? headerValue(header, key);
  const unit = read("Unit");
  const magnification = read("Magnification");
  const factor = ((unit !== undefined && unit > 0 ? unit : 8192) / SP_PER_POINT);
  const zoom = (magnification !== undefined && magnification > 0 ? magnification : 1000) / 1000;
  const xOffset = read("X Offset") ?? 0;
  const yOffset = read("Y Offset") ?? 0;
  return {
    x: (raw) => (raw * zoom + xOffset) * factor,
    y: (raw) => (raw * zoom + yOffset) * factor,
    size: (raw) => raw * zoom * factor,
  };
}
