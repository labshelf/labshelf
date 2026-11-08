// The build copy that previews a candidate style: the deck's source in that style, cut down so one page of it is the current slide.
import type { DeckStyle } from "./deckStyleTokens.js";
import { setSourceDeckStyle, sourceDeckTemplate } from "./deckStyleSource.js";
import { readSourceDeckBlocks } from "./sourceDeckBlocks.js";
import type { SourceDeckFormat } from "./sourceDecks.js";

/**
 * The source with `style` written (setSourceDeckStyle), ready to compile for the slide-th slide (0-based): a beamer talk keeps only that frame
 * and shows it as page 1; a Typst talk keeps its text whole and shows the slide on page `slide + 1`; a poster keeps its text and page 1.
 * Nothing outside the style block and the removed frames changes. Null when the source has no known template, the style cannot be written or
 * a beamer talk has no such slide.
 */
export function stylePreviewSource(format: SourceDeckFormat, text: string, style: DeckStyle, slide: number): { text: string; page: number } | null {
  const template = sourceDeckTemplate(format, text);
  const written = setSourceDeckStyle(format, text, style);
  if (template === null || written === null) return null;
  if (template !== "beamer") return { text: written.text, page: template === "touying" || template === "typst" ? slide + 1 : 1 };
  const slides = readSourceDeckBlocks(format, "talk", written.text).filter((node) => node.kind === "slide");
  if (slide < 0 || slide >= slides.length) return null;
  let copy = written.text;
  for (let i = slides.length - 1; i >= 0; i--) {
    if (i === slide) continue;
    const [from, to] = slides[i]!.range;
    copy = copy.slice(0, from) + copy.slice(to);
  }
  return { text: copy, page: 1 };
}
