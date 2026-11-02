// QR SVG writer: one line, a white background and one black path of unit squares, no style attributes.
import { escapeHtml } from "../ui/index.js";

export interface QrSvgOptions { margin?: number; label?: string }

/** Writes a QR matrix (matrix[row][column], true for dark) as a one-line SVG with a quiet zone of `margin` modules. */
export function formatQrSvg(matrix: readonly (readonly boolean[])[], options?: QrSvgOptions): string {
  const margin = options?.margin ?? 4;
  const label = escapeHtml(options?.label ?? "QR code");
  const n = matrix.length + 2 * margin;
  let d = "";
  matrix.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (dark) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    });
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${label}">` +
    `<rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
  );
}
