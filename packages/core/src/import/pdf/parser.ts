/**
 * Orchestrates the PDF import pipeline: collects every available signal, then merges them field by field.
 * Pdfjs bootstrap lives in the consumer package; core only sees the injected opener.
 * Holds the parser, the file-signal reader and the record builder it runs on.
 */
import { detectIdentifiers, type DetectedIdentifier } from "../identifiers/index.js";
import { createCiteKey, isPdfBytes } from "../../library/index.js";
import type { ILogger } from "../../ports/index.js";
import { formatError } from "../../errors/index.js";
import { resolveFirstIdentifier } from "../search/index.js";
import {
  mergeMetadata,
  parseString,
  SOURCE_TRUST,
  type MetadataSource,
  type MetadataConfidence,
  type ResolvedMetadata,
} from "../registries/index.js";
import { extractAbstract, extractYearFromText } from "./frontMatter.js";
import {
  extractTitleFromPlainText,
  extractTitleFromBlocks,
  normalizeAuthors,
  normalizeTitle,
  deriveUsableTitle,
} from "./frontPage.js";
import { isSparseText, isNaturalText, extractUrls, extractPageTexts, extractTitleBlocks } from "./textExtraction.js";
import { extractMetadataFromXmp } from "./xmp.js";
import type { ParsedPdfImport, PdfDocumentLike, PdfOpener, PdfOcrEngine, PdfSignals } from "./pdfDocument.js";
import { resolveOnline, deriveLocalSources, type ConfirmedIdentifier } from "./sources.js";

const PDF_PARSER_MODULE = "import/pdf";
// OCR is expensive, so only the pages that carry the masthead are read.
const OCR_PAGES = [1, 2];

export interface PdfImportParserOptions {
  // Optional: enables recovery of PDFs whose text layer is scanned or whose
  // fonts carry a broken character map.
  ocr?: PdfOcrEngine | undefined;
  /** Where a failed registry lookup is reported; the lookup then degrades to "no confirmed identifier". */
  logger?: ILogger | undefined;
}

// The text identifiers and registry searches work from, and whether OCR supplied part of it.
interface FrontMatterText {
  text: string;
  usedOcr: boolean;
  ocrTitle: string | undefined;
}

interface Identification {
  identifiers: DetectedIdentifier[];
  confirmed: ConfirmedIdentifier | undefined;
}

/**
 * The goal is to leave as few fields empty as possible, so parsing does not
 * stop at the first source that answers: identifiers confirmed against their
 * registry, OCR when the text layer is unreadable, a registry search, DOI
 * enrichment, then XMP, publisher keys, page text, layout and the filename.
 * Only after all of that does the caller fall back to asking the user.
 */
export class PdfImportParser {
  private readonly ocr: PdfOcrEngine | undefined;
  private readonly logger: ILogger | undefined;

  constructor(
    private readonly opener: PdfOpener,
    options: PdfImportParserOptions = {},
  ) {
    this.ocr = options.ocr;
    this.logger = options.logger;
  }

  /**
   * Parses a PDF byte buffer into a structured metadata record: title, authors, year, DOI and citation key.
   * @returns A fully populated ParsedPdfImport object.
   */
  async parse(pdfBytes: Uint8Array, fileStem: string): Promise<ParsedPdfImport> {
    if (!isPdfBytes(pdfBytes)) { throw new Error("File is not a valid PDF (missing %PDF- header)."); }
    const signals = await readPdf(this.opener, pdfBytes, this.logger);

    // Fonts without a usable character map yield scrambled text. Such text can
    // still hide an identifier by luck, but must never become a title or name.
    const embeddedIsReadable = isNaturalText(signals.frontMatter);
    let front = await this.readFrontMatter(pdfBytes, signals, embeddedIsReadable);
    let identification = await identify(signals, front.text, this.logger);

    const layoutTitle = embeddedIsReadable ? extractTitleFromBlocks(signals.titleBlocks) : undefined;
    let localTitle: string | undefined = deriveUsableTitle(signals.xmp?.title) ?? deriveUsableTitle(parseString(signals.info["Title"])) ?? layoutTitle;

    // Nothing identified the paper and the file offers no title either. The
    // text layer may be readable yet empty of front matter — a title page
    // stored as an image. Reading it optically is the last thing left to try.
    if (!identification.confirmed && !localTitle && !front.usedOcr) {
      const rescued = await this.rescueWithOcr(pdfBytes, signals, front);
      if (rescued) {
        front = rescued.front;
        identification = rescued.identification;
      }
    }

    return assemble({ fileStem, signals, front, identification, embeddedIsReadable, layoutTitle, localTitle, logger: this.logger });
  }

  // A near-empty text layer passes the readability test for lack of evidence,
  // yet says nothing about the paper: the pages are scans, or were re-printed
  // from a browser. Whatever title the file claims then is the printer's.
  private async readFrontMatter(
    pdfBytes: Uint8Array,
    signals: PdfSignals,
    embeddedIsReadable: boolean,
  ): Promise<FrontMatterText> {
    const embedded: FrontMatterText = { text: signals.frontMatter, usedOcr: false, ocrTitle: undefined };
    if (embeddedIsReadable && !isSparseText(signals.pageTexts)) {
      return embedded;
    }
    const ocrText = await this.runOcr(pdfBytes);
    if (!ocrText) {
      return embedded;
    }
    // A sparse layer is a stamp or print header repeated on every page. It
    // may still hold an identifier, so it is kept — but behind the OCR text,
    // or it would be all that the registry search ever sees.
    return withOcr(embedded, ocrText, embeddedIsReadable);
  }

  private async rescueWithOcr(
    pdfBytes: Uint8Array,
    signals: PdfSignals,
    front: FrontMatterText,
  ): Promise<{ front: FrontMatterText; identification: Identification } | undefined> {
    const ocrText = await this.runOcr(pdfBytes);
    if (!ocrText) {
      return undefined;
    }
    const rescued = withOcr(front, ocrText, true);
    return { front: rescued, identification: await identify(signals, rescued.text, this.logger) };
  }

  // Reads the front matter optically; failures degrade to no OCR text at all.
  private async runOcr(pdfBytes: Uint8Array): Promise<string> {
    if (!this.ocr) {
      return "";
    }
    return this.ocr.recognize(pdfBytes, OCR_PAGES).catch(async (error: unknown) => {
      await this.logger?.log("WARN", PDF_PARSER_MODULE, "OCR failed; reading the PDF without it", { message: formatError(error) });
      return "";
    });
  }
}

interface AssembleInput {
  fileStem: string;
  signals: PdfSignals;
  front: FrontMatterText;
  identification: Identification;
  embeddedIsReadable: boolean;
  layoutTitle: string | undefined;
  localTitle: string | undefined;
  logger: ILogger | undefined;
}

// Asks the registries about the paper, merges their answer with everything the file says itself, and grades it.
async function assemble(input: AssembleInput): Promise<ParsedPdfImport> {
  const { signals, front, identification, embeddedIsReadable } = input;
  const textIsReadable = embeddedIsReadable || isNaturalText(front.text);
  const abstract = textIsReadable ? extractAbstract(front.text) : undefined;
  // OCR text has no font sizes, so its title is a guess from line shape alone.
  const localTitle = input.localTitle ?? (textIsReadable ? front.ocrTitle : undefined);

  const frontMatter = front.text;
  const { confirmed } = identification;
  const online = await resolveOnline({ confirmed, signals, localTitle, frontMatter, abstract, usedOcr: front.usedOcr, textIsReadable, logger: input.logger });
  const local = deriveLocalSources({ signals, frontMatter, abstract, layoutTitle: input.layoutTitle, ocrTitle: front.ocrTitle, embeddedIsReadable, textIsReadable });
  return createParsedPaperRecord({
    sources: [...online.sources, ...local],
    fileStem: input.fileStem,
    frontMatter,
    textIsReadable,
    identifiers: identification.identifiers,
    identifierConfirmed: Boolean(confirmed),
    resolvedOnline: online.resolved,
    origin: online.origin,
    usedOcr: front.usedOcr,
  });
}

function withOcr(front: FrontMatterText, ocrText: string, keepEmbedded: boolean): FrontMatterText {
  return {
    text: keepEmbedded ? `${ocrText}\n${front.text}`.trim() : ocrText,
    usedOcr: true,
    ocrTitle: deriveUsableTitle(extractTitleFromPlainText(ocrText)),
  };
}

async function identify(signals: PdfSignals, frontMatter: string, logger: ILogger | undefined): Promise<Identification> {
  const identifiers = detectIdentifiers(signals.info, frontMatter, signals.linkUrls);
  const confirmed = await resolveFirstIdentifier(identifiers, { logger }).catch(async (error: unknown) => {
    await logger?.log("WARN", PDF_PARSER_MODULE, "Identifier lookup failed; continuing without a confirmed identifier", {
      identifiers: identifiers.map((found) => found.value), message: formatError(error),
    });
    return undefined;
  });
  return { identifiers, confirmed };
}

// Builds the ParsedPdfImport record from the merged metadata of every source.
function gradeConfidence(
  identifierConfirmed: boolean,
  resolvedOnline: boolean,
  metadata: ResolvedMetadata,
): MetadataConfidence {
  if (identifierConfirmed) {
    return "high";
  }
  if (resolvedOnline) {
    return "medium";
  }
  return metadata.title ? "medium" : "low";
}

export interface PaperRecordInput {
  sources: MetadataSource[];
  fileStem: string;
  frontMatter: string;
  textIsReadable: boolean;
  identifiers: DetectedIdentifier[];
  identifierConfirmed: boolean;
  resolvedOnline: boolean;
  origin: string | undefined;
  usedOcr: boolean;
}

export function createParsedPaperRecord(input: PaperRecordInput): ParsedPdfImport {
  const merged = mergeMetadata(input.sources);
  const metadata = merged.metadata;
  const title = normalizeTitle(metadata.title ?? input.fileStem);
  const year = metadata.year ?? (input.textIsReadable ? extractYearFromText(input.frontMatter) : undefined);
  const authors = normalizeAuthors(metadata.authors);
  // CONTRACT: documents/contracts/library-format.md#paper-identity (the key names the folder for good, so a guessed surname stays wrong)
  const keyAuthors = authorTrust(input.sources, merged.fieldSources["authors"]) >= SOURCE_TRUST.xmp ? authors : [];
  const citeKey = createCiteKey({ authors: keyAuthors, year, title }, title);

  return {
    title,
    citeKey,
    authors,
    confidence: gradeConfidence(input.identifierConfirmed, input.resolvedOnline, metadata),
    ...presentField("source", describeOrigin(input.origin, merged.fieldSources, input.usedOcr)),
    ...(year ? { year } : {}),
    ...presentField("doi", metadata.doi),
    ...presentField("journal", metadata.journal),
    ...presentField("publisher", metadata.publisher),
    ...presentField("volume", metadata.volume),
    ...presentField("issue", metadata.issue),
    ...presentField("pages", metadata.pages),
    ...presentField("url", metadata.url),
    ...presentField("issn", metadata.issn),
    ...presentField("language", metadata.language),
    ...presentField("summary", metadata.summary),
    ...(metadata.keywords?.length ? { keywords: metadata.keywords } : {}),
  };
}

function authorTrust(sources: MetadataSource[], winner: string | undefined): number {
  return sources.find((source) => source.name === winner)?.trust ?? 0;
}

// Names the winning route plus how many distinct sources contributed, which is
// what a maintainer reading the log actually wants to know.
function describeOrigin(
  origin: string | undefined,
  fieldSources: Record<string, string>,
  usedOcr: boolean,
): string | undefined {
  const contributors = new Set(Object.values(fieldSources));
  if (contributors.size === 0) {
    return origin;
  }
  const base = origin ?? [...contributors][0] ?? "pdf";
  const suffix = usedOcr ? " +ocr" : "";
  return `${base}${suffix} (${contributors.size} source${contributors.size === 1 ? "" : "s"})`;
}

// Emits a single-key object only when the value is present, keeping presentField
// fields absent rather than set to undefined under exactOptionalPropertyTypes.
function presentField<K extends string>(key: K, value: string | undefined): Record<K, string> | Record<string, never> {
  return value ? ({ [key]: value } as Record<K, string>) : {};
}

// Reads every signal the PDF file itself carries, in one pass over the document.
function describePdfError(error: unknown): Error {
  const name = (error as { name?: unknown })?.name;
  const message = formatError(error);

  if (name === "PasswordException") {
    return new Error("The PDF is password-protected and could not be read.");
  }
  if (name === "InvalidPDFException" || /\b(root reference|xref|invalid pdf)\b/i.test(message)) {
    return new Error("The PDF is corrupted or incomplete and could not be read.");
  }
  return error instanceof Error ? error : new Error(message);
}

// Front matter carrying the title, authors and DOI rarely runs past page 3.
const FRONT_MATTER_PAGES = 3;
const PDF_SIGNALS_MODULE = "import/pdf";

export async function readPdf(
  opener: PdfOpener,
  pdfBytes: Uint8Array,
  logger: ILogger | undefined,
): Promise<PdfSignals> {
  const document = await openDocument(opener, pdfBytes);
  try {
    const metadata = await readOrEmpty(document.getMetadata(), undefined, "metadata", logger);
    const pageTexts = (await extractPageTexts(document, FRONT_MATTER_PAGES, logger)).map((page) => page.text);
    return {
      info: (metadata?.info as Record<string, unknown>) ?? {},
      xmp: extractMetadataFromXmp(metadata?.metadata),
      pageTexts,
      frontMatter: pageTexts.join("\n"),
      titleBlocks: await readOrEmpty(extractTitleBlocks(document), [], "title blocks", logger),
      linkUrls: await readOrEmpty(extractUrls(document, FRONT_MATTER_PAGES, logger), [], "link annotations", logger),
    };
  } finally {
    await readOrEmpty((async () => document.destroy())(), undefined, "cleanup", logger);
  }
}

// One unreadable signal must not cost the others, so a failure is logged and the signal left empty.
async function readOrEmpty<T>(read: Promise<T>, empty: T, signal: string, logger: ILogger | undefined): Promise<T> {
  try {
    return await read;
  } catch (error) {
    await logger?.log("WARN", PDF_SIGNALS_MODULE, `PDF ${signal} unreadable; continuing without it`, {
      message: formatError(error),
    });
    return empty;
  }
}

// Wraps the injected opener with friendly error mapping for password-protected and corrupt PDFs.
async function openDocument(opener: PdfOpener, pdfBytes: Uint8Array): Promise<PdfDocumentLike> {
  try {
    return await opener.open(pdfBytes);
  } catch (error) {
    throw describePdfError(error);
  }
}
