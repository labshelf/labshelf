/**
 * Renders TeX math to standalone SVG markup with MathJax, using a project's own macros, and turns that SVG into a
 * self-contained image: a fixed colour and pixel size, as a data URI.
 */
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

import { bytesToBase64 } from "../../encoding/index.js";
import type { MathJaxMacros } from "../sourceProject.js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

// `autoload` and `require` fetch extensions at run time, which a bundled host cannot do.
// `noerrors` would hide parse errors; `noundefined` stays, so a macro from a `.sty` the
// parser never sees shows as its red name instead of failing the whole preview.
const PACKAGES = AllPackages.filter((name) => !["autoload", "require", "noerrors"].includes(name));

type MathDocument = ReturnType<typeof mathjax.document>;
let cached: { key: string; document: MathDocument } | undefined;

/** Throws the TeX error message when the input does not parse, instead of rendering MathJax's error box. */
export function renderMathSvg(tex: string, display: boolean, macros: MathJaxMacros = {}): string {
  const node = documentFor(macros).convert(tex, { display });
  return adaptor.innerHTML(node);
}

// A MathJax document holds its macros, so one is kept per macro set; hovers within
// one project reuse it.
function documentFor(macros: MathJaxMacros): MathDocument {
  const key = JSON.stringify(macros);
  if (cached?.key !== key) {
    const input = new TeX({
      packages: PACKAGES,
      macros,
      formatError: (_jax: unknown, error: Error) => { throw error; },
    });
    cached = { key, document: mathjax.document("", { InputJax: input, OutputJax: new SVG({ fontCache: "local" }) }) };
  }
  return cached.document;
}

// INVARIANT: MathJax sizes its SVG in `ex`; an image loses the surrounding font, so
// the size is fixed in pixels at roughly a 14px editor font.
const PX_PER_EX = 7;

export interface MathColors {
  text: string;
  /** Replaces MathJax's red for commands it does not know. */
  error: string;
}

/** An `<img>` cannot inherit `currentColor`, so the caller passes the theme's colours. */
export function createMathImageUri(svg: string, colors: MathColors): string {
  const sized = svg.replace(/(width|height)="([\d.]+)ex"/g, (_m, side: string, ex: string) =>
    `${side}="${(Number(ex) * PX_PER_EX).toFixed(1)}px"`);
  const coloured = sized.replace(/"currentColor"/g, `"${colors.text}"`).replace(/"red"/g, `"${colors.error}"`);
  return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(coloured))}`;
}
