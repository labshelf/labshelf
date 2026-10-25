/** Resolves a paper against the online registries and collects the sources that record contributes. */
import { errorMessage } from "../../../logging/index.js";
import type { ILogger } from "../../../ports/index.js";
import { SOURCE_TRUST, type MetadataSource } from "../../metadata/index.js";
import { enrichByDoi, resolveFirstIdentifier, searchOnlineByQueries } from "../../search/index.js";
import type { PdfSignals } from "./readPdf.js";
import { searchQueries } from "./searchHints.js";

const ONLINE_MODULE = "import/pdf";

export type ConfirmedIdentifier = NonNullable<Awaited<ReturnType<typeof resolveFirstIdentifier>>>;

export interface OnlineInput {
  confirmed: ConfirmedIdentifier | undefined;
  signals: PdfSignals;
  localTitle: string | undefined;
  frontMatter: string;
  abstract: string | undefined;
  usedOcr: boolean;
  textIsReadable: boolean;
  logger: ILogger | undefined;
}

export interface OnlineRecord {
  // Registry sources, enrichment included; empty when no registry knew the paper.
  sources: MetadataSource[];
  resolved: boolean;
  // How the winning record was obtained, for logs and the import report.
  origin: string | undefined;
}

export async function resolveOnline(input: OnlineInput): Promise<OnlineRecord> {
  const { confirmed } = input;
  const env = { logger: input.logger };
  let resolved = confirmed?.metadata;
  let origin = confirmed ? `${confirmed.identifier.type}:${confirmed.identifier.value}` : undefined;

  // No identifier resolved — ask the registries to recognise the paper the
  // way a reader would, trying several shapes of the same question.
  if (!resolved && input.textIsReadable) {
    const queries = searchQueries(input.signals, input.localTitle, input.frontMatter, input.abstract);
    const match = await searchOnlineByQueries(queries, env).catch(degrade(input.logger, "Registry search failed; continuing without a match", undefined));
    if (match) {
      resolved = match.metadata;
      origin = input.usedOcr ? "search:ocr" : "search:text";
    }
  }
  if (!resolved) {
    return { sources: [], resolved: false, origin };
  }

  const sources: MetadataSource[] = [
    {
      name: origin ?? "registry",
      trust: confirmed ? SOURCE_TRUST.confirmedIdentifier : SOURCE_TRUST.search,
      metadata: resolved,
    },
  ];
  // A confirmed DOI unlocks the other registries, which fill the gaps the
  // first one left — CrossRef omits the abstract for most of its records.
  const doi = resolved.doi ?? (confirmed?.identifier.type === "doi" ? confirmed.identifier.value : undefined);
  if (doi) {
    sources.push(...(await enrichByDoi(doi, env).catch(degrade(input.logger, "DOI enrichment failed; continuing without it", [] as MetadataSource[]))));
  }
  return { sources, resolved: true, origin };
}

// A lookup that throws degrades to `fallback`, with a WARN so the missing record is explained.
function degrade<T>(logger: ILogger | undefined, message: string, fallback: T): (error: unknown) => Promise<T> {
  return async (error) => {
    await logger?.log("WARN", ONLINE_MODULE, message, { message: errorMessage(error) });
    return fallback;
  };
}
