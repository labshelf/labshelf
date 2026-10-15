// Orders the resolver chain: page hints, then constructed addresses, then API lookups.
import {
  arxivResolver, crossrefResolver, europePmcResolver, openalexResolver, pageHintResolver, pmcResolver,
  publisherResolver, sciHubResolver, semanticScholarResolver, unpaywallResolver,
} from "./resolvers/index.js";
import type { PdfResolver } from "./types.js";

// INVARIANT: learners (OpenAlex, Semantic Scholar, Europe PMC) run before PMC and the publisher so the ids they reveal feed those.
// arXiv runs twice in case a learner revealed an id; a URL already tried is skipped by the chain.
export const RESOLVER_ORDER: readonly PdfResolver[] = [
  pageHintResolver,
  arxivResolver,
  openalexResolver,
  semanticScholarResolver,
  europePmcResolver,
  arxivResolver,
  pmcResolver,
  publisherResolver,
  crossrefResolver,
  unpaywallResolver,
  sciHubResolver,
];
