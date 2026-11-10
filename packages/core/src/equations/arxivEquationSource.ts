/** The arXiv equation source: loads a paper's e-print once, lists its equations and picks the one a box shows. */
import { arxivIdOfRecord } from "../import/identifiers/arxiv.js";
import type { PaperRecord } from "../model/index.js";
import type { FetchLike, ILogger } from "../ports/index.js";
import { loadEprint, type EprintCache } from "./arxivSource.js";
import { listEquations, type SourceEquation } from "./enumerate.js";
import type { EquationSource } from "./extractor.js";
import { findMainFile, flattenSource } from "./flatten.js";
import { matchEquation } from "./match.js";

export function createArxivEquationSource(deps: { recordOf(paperId: string): Promise<Pick<PaperRecord, 'doi' | 'url'> | undefined>; fetch: FetchLike; cache: EprintCache; logger: ILogger }): EquationSource {
  // One load per paper for the session; a failed load is dropped so the next try downloads again.
  const loaded = new Map<string, Promise<SourceEquation[]>>();

  const arxivIdOf = async (paperId: string): Promise<string | undefined> => {
    const record = await deps.recordOf(paperId);
    return record === undefined ? undefined : arxivIdOfRecord(record);
  };

  async function load(arxivId: string, signal?: AbortSignal): Promise<SourceEquation[]> {
    const eprint = await loadEprint(arxivId, { fetch: deps.fetch, cache: deps.cache, logger: deps.logger }, signal);
    if (eprint.kind === "none") { return []; }
    const main = findMainFile(eprint.files);
    return main === undefined ? [] : listEquations(flattenSource(eprint.files, main));
  }

  function equationsOf(arxivId: string, signal?: AbortSignal): Promise<SourceEquation[]> {
    const known = loaded.get(arxivId);
    if (known !== undefined) { return known; }
    const pending = load(arxivId, signal);
    loaded.set(arxivId, pending);
    pending.catch(() => { if (loaded.get(arxivId) === pending) { loaded.delete(arxivId); } });
    return pending;
  }

  return {
    id: "arxiv",
    async available(request) { return (await arxivIdOf(request.paperId)) !== undefined; },
    async read(request, onProgress, signal) {
      const arxivId = await arxivIdOf(request.paperId);
      if (arxivId === undefined) { return undefined; }
      onProgress("Reading the paper's arXiv source");
      const match = matchEquation(request.text, await equationsOf(arxivId, signal));
      if (match === undefined) { return undefined; }
      const { equation } = match;
      // Several equations share this LaTeX: the box is one of them, but not known which number or label.
      const known = match.by !== "sameLatex";
      const number = known ? equation.numbers[0] : undefined;
      const label = known ? equation.labels[0] : undefined;
      return {
        latex: equation.latex,
        ...(number !== undefined ? { number } : {}),
        ...(label !== undefined ? { label } : {}),
      };
    },
  };
}
