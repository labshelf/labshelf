// Which source slide each numbered beamer frame of a talk shows, so PDF page labels (frame numbers) map to slides through section dividers.
import { removeComments } from "../latex/index.js";
import { balancedGroup, latexDocumentStart, latexFrameSpans, latexSectionHooks, readSourceDeckOutline, skipSpace } from "./sourceDeckOutline.js";

const HAS_FRAME = /\\begin\s*\{frame\}|\\frame\b/;

/** Whether the frame whose arguments start at `after` has the noframenumbering option (in a `[…]` after any `<…>` overlay spec). */
function unnumbered(code: string, after: number): boolean {
  let i = skipSpace(code, after);
  if (code[i] === "<") {
    const close = code.indexOf(">", i);
    if (close === -1) return false;
    i = skipSpace(code, close + 1);
  }
  if (code[i] !== "[") return false;
  const group = balancedGroup(code, i);
  return group !== null && /\bnoframenumbering\b/.test(code.slice(group[0], group[1] - 1));
}

/**
 * The numbered frames of a talk in output order: each entry is the index of an outline slide (as readSourceDeckNotes counts them), or null
 * for a divider frame that `\AtBeginSection` / `\AtBeginSubsection` adds at a `\section` / `\subsection`. Typst: one entry per slide.
 */
export function readSourceDeckFrames(format: "latex" | "typst", text: string): Array<number | null> {
  if (format === "typst") return readSourceDeckOutline("typst", "talk", text).map((_, index) => index);
  const code = removeComments(text);
  const hooks = latexSectionHooks(code);
  const divider = (level: "section" | "subsection", starred: boolean): boolean =>
    hooks.some((hook) => hook.level === level && (starred ? hook.opt !== null && HAS_FRAME.test(hook.opt) : HAS_FRAME.test(hook.body)));
  const events: Array<{ at: number; entry: number | null | undefined }> = [];
  latexFrameSpans(code).forEach((span, index) => {
    events.push({ at: span.at, entry: unnumbered(code, span.after) ? undefined : index });
  });
  const documentStart = latexDocumentStart(code);
  const sections = /\\(section|subsection)\b\s*(\*)?/g;
  for (let match = sections.exec(code); match; match = sections.exec(code)) {
    if (match.index < documentStart || hooks.some((hook) => match!.index >= hook.start && match!.index < hook.end)) continue;
    if (divider(match[1] as "section" | "subsection", match[2] === "*")) events.push({ at: match.index, entry: null });
  }
  return events.sort((a, b) => a.at - b.at).filter((event) => event.entry !== undefined).map((event) => event.entry as number | null);
}
