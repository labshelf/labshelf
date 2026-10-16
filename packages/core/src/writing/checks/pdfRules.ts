/** Checks the PDF's layout facts against common desk-reject causes: page limit, Type 3 fonts, low-resolution images and unresolved references. */
import type { CheckFinding, PdfFacts } from "./checkTypes.js";
import type { PaperBody } from "./paperBody.js";

const MIN_DPI = 300;
/** `??` is LaTeX's mark for an unresolved \ref; `[?]` and `(?)` mark unresolved citations in numeric and author-year styles. */
const UNRESOLVED = /\?\?|\[\?(?:,\s*\?)*\]|\(\?\)/g;

export function pageLimitFindings(body: PaperBody, limit: number | undefined): CheckFinding[] {
  if (limit === undefined || body.contentPages <= limit) { return []; }
  const counted = body.headingFound ? `${body.contentPages} pages before the references` : `${body.contentPages} pages (no References heading found, so every page counts)`;
  return [{ rule: "pages", severity: "error", message: `The paper has ${counted}; the limit is ${limit}.`, location: { kind: "pdf" } }];
}

export function type3FontFindings(facts: PdfFacts): CheckFinding[] {
  const pages = facts.pages.flatMap((page, index) => (page.fonts.some((font) => font.type3) ? [index + 1] : []));
  if (pages.length === 0) { return []; }
  return [{
    rule: "fonts",
    severity: "warning",
    message: `Type 3 fonts on page${pages.length > 1 ? "s" : ""} ${pages.join(", ")}; many venues reject them. They usually come from a figure: in matplotlib set pdf.fonttype to 42.`,
    location: { kind: "pdf", page: pages[0] },
  }];
}

export function imageResolutionFindings(facts: PdfFacts): CheckFinding[] {
  return facts.pages.flatMap((page, index) =>
    page.images.flatMap((image) => {
      if (image.width <= 0 || image.height <= 0) { return []; }
      const dpi = Math.round(Math.min(image.pixelWidth / (image.width / 72), image.pixelHeight / (image.height / 72)));
      if (dpi >= MIN_DPI) { return []; }
      return [{
        rule: "images" as const,
        severity: "warning" as const,
        message: `A ${image.pixelWidth}×${image.pixelHeight} image on page ${index + 1} prints at ${dpi} dpi, under ${MIN_DPI}; export the figure as a vector PDF or at a higher resolution.`,
        location: { kind: "pdf" as const, page: index + 1 },
      }];
    }),
  );
}

export function unresolvedReferenceFindings(facts: PdfFacts): CheckFinding[] {
  return facts.pages.flatMap((page, index) => {
    const count = page.lines.reduce((sum, line) => sum + (line.match(UNRESOLVED)?.length ?? 0), 0);
    if (count === 0) { return []; }
    return [{
      rule: "references" as const,
      severity: "error" as const,
      message: `${count} unresolved reference${count > 1 ? "s or citations" : " or citation"} (?? or [?]) on page ${index + 1}.`,
      location: { kind: "pdf" as const, page: index + 1 },
    }];
  });
}
