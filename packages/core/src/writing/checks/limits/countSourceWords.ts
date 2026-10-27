/** Counts the words of a root's sources, from the start up to the References heading or the end of the document. */
import { countWords, removeComments } from "../../../latex/source.js";
import type { CountUpTo } from "../../project/index.js";

const BIBLIOGRAPHY = /\\(?:print)?bibliography|#bibliography/;

/** `sources` are the root's texts in reading order, each include placed where it is written. */
export function countWordsUpTo(sources: readonly { text: string }[], countUpTo: CountUpTo): number {
  const text = removeComments(sources.map((source) => source.text).join("\n"));
  if (countUpTo === "end") { return countWords(text); }
  const body = text.indexOf("\\begin{document}");
  const stop = text.slice(Math.max(body, 0)).search(BIBLIOGRAPHY);
  return countWords(stop < 0 ? text : text.slice(0, Math.max(body, 0) + stop));
}
