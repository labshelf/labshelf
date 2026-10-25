// Measures a built root for the preview chrome: the problems placed on its PDF, its citation count and its words.
import type { ILogger, PdfProblem } from "@labshelf/core";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";

export interface RootFindingsInput {
  logger?: ILogger | undefined;
  pdfProblemsOf: (root: string) => Promise<{ pdfProblems: PdfProblem[]; cites: number }>;
  wordsOf: (root: string) => Promise<number>;
}

/** A measure that fails is logged and left absent, so the root still shows the rest. */
async function attempt<T>(input: RootFindingsInput, root: string, what: string, measure: () => Promise<T>): Promise<T | undefined> {
  try {
    return await measure();
  } catch (error) {
    await input.logger?.error(PREVIEW_LOG_MODULE, error, { root, action: what });
    return undefined;
  }
}

export async function rootFindings(input: RootFindingsInput, root: string): Promise<{ pdfProblems?: PdfProblem[]; cites?: number; words?: number }> {
  const [placed, words] = await Promise.all([
    attempt(input, root, "pdfProblems", () => input.pdfProblemsOf(root)),
    attempt(input, root, "words", () => input.wordsOf(root)),
  ]);
  return {
    ...(placed ? { pdfProblems: placed.pdfProblems, cites: placed.cites } : {}),
    ...(words !== undefined ? { words } : {}),
  };
}
