// Describes the demo paper the reader opens and the highlight it already carries.
// Fields mirror website/demo-library/papers/Language models/Reasoning/wei2022chainofthought/metadata.yaml.
import type { AnnotationColor, PaperRecord, ReadingState } from "@labshelf/core";

export const DEMO_PAPER: PaperRecord = {
  id: "wei2022chainofthought",
  title: "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models",
  path: "Language models/Reasoning/wei2022chainofthought",
  citeKey: "wei2022chainofthought",
  status: "done",
  authors: ["Jason Wei", "Xuezhi Wang", "Dale Schuurmans", "Maarten Bosma", "Brian Ichter", "Fei Xia", "Ed Chi", "Quoc Le", "Denny Zhou"],
  year: 2022,
  journal: "arXiv preprint",
  url: "https://arxiv.org/abs/2201.11903",
  pdfVersion: "preprint",
};

export interface SeededHighlight {
  pageNumber: number;
  /** Text of the abstract as the text layer reads it; the reader finds the highlight by this text. */
  content: string;
  color: AnnotationColor;
}

export const SEEDED_HIGHLIGHT: SeededHighlight = {
  pageNumber: 1,
  content: "complex reasoning. In particular, we show how such reasoning abilities emerge",
  color: "yellow",
};

// Opens on the abstract with the Annotations tab showing, so the visitor sees the highlight at once.
// `top` is in PDF points from the page's bottom edge, where pdf.js destinations measure it.
export const OPENING_STATE: Omit<ReadingState, "updatedAt"> = {
  page: 1,
  scaleValue: "page-width",
  top: 530,
  sidebar: { open: true, tab: "annotations", width: 220 },
};
