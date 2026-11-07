// MathJax SVG markup to a style-free element, without prosemirror, so the lazy drawing editor can import it cheaply; mathView.ts re-exports it.

/** Loads MathJax: the drawing labels, math views and figure editor typeset through it. */
export type MathLoader = () => Promise<{ renderMathSvg(tex: string, display: boolean): string }>;

const VALIGN_PROPERTY = "--qmd-math-valign";

/**
 * Turns MathJax SVG markup into an element without any `style` attribute.
 * PLATFORM: the webview CSP forbids markup `style=`, so the markup is parsed in an inert document, every `style`
 * attribute is dropped, and the root's `vertical-align` moves to the `--qmd-math-valign` custom property, set through
 * CSSOM (allowed under that CSP); the stylesheet applies it as `vertical-align: var(--qmd-math-valign)`.
 */
export function parseMathSvg(markup: string): Element {
  const parsed = new DOMParser().parseFromString(markup, "text/html").querySelector("svg");
  if (!parsed) throw new Error("MathJax returned no SVG");
  const valign = /vertical-align:\s*([^;]+)/.exec(parsed.getAttribute("style") ?? "")?.[1]?.trim();
  for (const node of [parsed, ...Array.from(parsed.querySelectorAll("[style]"))]) node.removeAttribute("style");
  const svg = document.importNode(parsed, true);
  if (valign) svg.style.setProperty(VALIGN_PROPERTY, valign);
  return svg;
}

const UNIT_PX: Record<string, number> = { ex: 8, em: 16, px: 1 };

/** The width or height of an SVG markup string in CSS pixels (MathJax sizes in ex). */
export function svgDimension(markup: string, name: "width" | "height"): number {
  const match = new RegExp(`<svg[^>]*\\s${name}="([\\d.]+)(ex|em|px)?"`).exec(markup);
  return match ? Number(match[1]) * (UNIT_PX[match[2] ?? "px"] ?? 1) : 0;
}
