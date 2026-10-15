/** Lists the lookups in download rank (page, publisher, open-access copies, user resolvers) and what each waits for. */
import {
  arxivResolver, crossrefResolver, europePmcResolver, openalexResolver, pageHintResolver, pmcResolver,
  publisherResolver, customResolver, semanticScholarResolver, unpaywallResolver,
} from "../resolvers/index.js";
import type { PdfResolver } from "../types.js";

export interface LookupStep {
  resolver: PdfResolver;
  /** Lookups whose answers this one reads off the context, so it starts once they settle. */
  after?: readonly PdfResolver[];
}

const LEARNERS = [openalexResolver, semanticScholarResolver, europePmcResolver];

// INVARIANT: learners (OpenAlex, Semantic Scholar, Europe PMC) settle before PMC and the second arXiv step, so the
// ids they reveal feed those; the publisher rules wait for the landing page, whose URL keys some platforms.
// arXiv appears twice: an id known from the start downloads early, a learned one later; a URL is tried once.
export function lookupPlan(landing: PdfResolver): LookupStep[] {
  return [
    { resolver: pageHintResolver },
    { resolver: landing },
    { resolver: publisherResolver, after: [landing] },
    { resolver: arxivResolver },
    ...LEARNERS.map((resolver) => ({ resolver })),
    { resolver: arxivResolver, after: LEARNERS },
    { resolver: pmcResolver, after: LEARNERS },
    { resolver: crossrefResolver },
    { resolver: unpaywallResolver },
    { resolver: customResolver },
  ];
}
