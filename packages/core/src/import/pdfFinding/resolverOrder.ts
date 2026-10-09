/**
 * The order the chain tries resolvers in. What the page offered beats a constructed address, which beats an API
 * lookup. The learners (OpenAlex, Semantic Scholar, Europe PMC) run before PMC and the publisher so the identifiers
 * they reveal feed those; arXiv runs a second time in case a learner revealed an id (an id known from the start
 * produces a URL already tried, which the chain skips).
 */
import {
  arxivResolver, crossrefResolver, europePmcResolver, openalexResolver, pageHintResolver, pmcResolver,
  publisherResolver, sciHubResolver, semanticScholarResolver, unpaywallResolver,
} from "./resolvers/index.js";
import type { PdfResolver } from "./types.js";

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
