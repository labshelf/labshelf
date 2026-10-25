// Keeps the highlights of a paper that have text to quote.
import type { Annotation } from "../../model/index.js";

// A highlight without text cannot be quoted or recognised in a list.
export const listQuotableHighlights = (annotations: readonly Annotation[]): Annotation[] =>
  annotations.filter((annotation) => annotation.type === "highlight" && annotation.content.trim() !== "");
