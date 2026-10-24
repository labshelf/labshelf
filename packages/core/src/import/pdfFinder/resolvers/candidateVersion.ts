/** Tells which version of the paper a candidate URL holds, from its source's label, its host or the resolver that proposed it. */
import { arxivIdFromUrl } from "../../identifiers/index.js";
import type { PdfVersion } from "../../../model/index.js";
import type { ResolveContext } from "../pdfResolver.js";

const PREPRINT_SERVER = /(^|\.)(biorxiv|medrxiv)\.org$/i;

// OpenAlex locations and Unpaywall oa_locations share these labels.
const OA_LABELS: Record<string, PdfVersion> = {
  submittedVersion: "preprint",
  acceptedVersion: "accepted",
  publishedVersion: "published",
};

/**
 * Maps an OpenAlex or Unpaywall `version` label; anything else is unknown.
 * TRAP: both label some publishers' own PDFs `submittedVersion` (PLOS), so a publisher-hosted copy keeps no
 * pre-publication label.
 */
export function versionFromOaLabel(label: string | null | undefined, publisherHosted: boolean): PdfVersion | undefined {
  const version = label ? OA_LABELS[label] : undefined;
  return publisherHosted && version !== "published" ? undefined : version;
}

/** Records the version a lookup's source gave for a URL, for `candidateVersion` to read. */
export function noteVersion(ctx: ResolveContext, url: string, version: PdfVersion | undefined): void {
  if (!version) return;
  ctx.versions ??= new Map();
  if (!ctx.versions.has(url)) ctx.versions.set(url, version);
}

/** True for a URL on arXiv, bioRxiv or medRxiv, which serve preprints only. */
export function isPreprintServerUrl(url: string): boolean {
  if (arxivIdFromUrl(url)) return true;
  try {
    return PREPRINT_SERVER.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Lookups that read the article's own page or the publisher's URL scheme, not an aggregator's index.
const FROM_THE_ARTICLE = new Set(["page", "landing", "publisher"]);

/**
 * A preprint server's URL is a preprint. A link from the article's own page carries no aggregator label, because
 * aggregators file publishers' PDFs as repository preprints (PLOS); otherwise a source's label wins. A publisher rule's
 * URL is the published version.
 * @returns the version, or undefined when nothing says
 */
export function candidateVersion(ctx: ResolveContext, resolver: string, url: string): PdfVersion | undefined {
  if (isPreprintServerUrl(url)) return "preprint";
  if (resolver === "publisher") return "published";
  return FROM_THE_ARTICLE.has(resolver) ? undefined : ctx.versions?.get(url);
}
