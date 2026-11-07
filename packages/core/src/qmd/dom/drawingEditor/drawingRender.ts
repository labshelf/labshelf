// Turns a drawing model into what its figure block stores (TikZ, SVG and PNG) and into an SVG element, with MathJax setting
// the labels; shared by the note's figure view and the figure editor's drawing mode.
import { formatDrawingSvg, formatTikz, layoutDrawing, type DrawingModel, type LabelBox } from "../../../drawing/index.js";
import { paintDrawingPng, type CanvasFactory } from "./drawingPng.js";
import { svgDimension, type MathLoader } from "./mathSvg.js";

const DOM_CANVAS: CanvasFactory = {
  create(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
};

/** An SVG element from markup, without any `style` attribute (the webview CSP forbids them); null when the markup holds no SVG. */
export function parseSvg(markup: string): Element | null {
  const parsed = new DOMParser().parseFromString(markup, "text/html").querySelector("svg");
  if (!parsed) return null;
  for (const node of [parsed, ...Array.from(parsed.querySelectorAll("[style]"))]) node.removeAttribute("style");
  return document.importNode(parsed, true);
}

/** The label renderer and measurer MathJax gives: a label's size in CSS pixels comes from its SVG's width and height. */
function labelTools(math: Awaited<ReturnType<MathLoader>>): { renderLabel(tex: string): string; measure(tex: string): LabelBox } {
  const renderLabel = (tex: string): string => math.renderMathSvg(tex, false);
  return { renderLabel, measure: (tex) => { const markup = renderLabel(tex); return { width: svgDimension(markup, "width"), height: svgDimension(markup, "height") }; } };
}

/** The drawing's SVG markup, with its labels set. */
export async function drawingSvg(model: DrawingModel, loadMath: MathLoader): Promise<string> {
  const tools = labelTools(await loadMath());
  return formatDrawingSvg(model, layoutDrawing(model, tools.measure), tools.renderLabel);
}

/** The TikZ, SVG and PNG a drawing figure stores; null when the PNG cannot be painted. */
export async function renderDrawingParts(model: DrawingModel, loadMath: MathLoader): Promise<{ tikz: string; svg: string; png: string } | null> {
  const tools = labelTools(await loadMath());
  const layout = layoutDrawing(model, tools.measure);
  const svg = formatDrawingSvg(model, layout, tools.renderLabel);
  const png = paintDrawingPng(svg, DOM_CANVAS);
  return png === null ? null : { tikz: formatTikz(model, layout), svg, png };
}
