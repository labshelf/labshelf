/**
 * Renders TeX math to standalone SVG markup with MathJax, using a project's own macros, and turns that SVG into a
 * self-contained image: a fixed colour and pixel size, as a data URI.
 */
import type { LiteDocument } from "mathjax-full/js/adaptors/lite/Document.js";
import type { LiteElement } from "mathjax-full/js/adaptors/lite/Element.js";
import type { LiteText } from "mathjax-full/js/adaptors/lite/Text.js";
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

/**
 * TRAP: the lite adaptor knows no font, so MathJax gives every character missing from its TeX fonts (`á`, `ç`) the
 * same width and an accented letter in `\text{}` sat in a gap. Such a letter takes the width of its base letter.
 */
class AccentWidthSvg extends SVG<LiteElement, LiteText, LiteDocument> {
  override measureTextNode(text: LiteElement): ReturnType<SVG<LiteElement, LiteText, LiteDocument>["measureTextNode"]> {
    const bbox = super.measureTextNode(text);
    const named = this.adaptor.getAttribute(text, "data-variant") ?? "";
    const variant = this.font.getVariant(named) ? named : "normal";
    let width = 0;
    for (const char of this.adaptor.textContent(text)) {
      const base = char.normalize("NFD").codePointAt(0);
      const data = base === undefined || base === char.codePointAt(0) ? undefined : this.font.getChar(variant, base);
      if (!data) return bbox;
      width += data[2];
    }
    return { ...bbox, w: width };
  }
}
let cached: { key: string; document: MathDocument } | undefined;

/** Throws the TeX error message when the input does not parse, instead of rendering MathJax's error box. */
export function renderMathSvg(tex: string, display: boolean, macros: MathJaxMacros = {}): string {
  const document = documentFor(macros);
  // TRAP: the document remembers every \label it rendered, so rendering the same labelled equation again failed as "multiply defined".
  for (const jax of document.inputJax) { if (jax instanceof TeX) jax.reset(); }
  try {
    return adaptor.innerHTML(document.convert(tex, { display }));
  } catch (error) {
    // MathJax throws a TexError, which is not an Error: callers would print "[object Object]".
    if (error instanceof Error) throw error;
    const message = (error as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : String(error));
  }
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
    cached = { key, document: mathjax.document("", { InputJax: input, OutputJax: new AccentWidthSvg({ fontCache: "local" }) }) };
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
