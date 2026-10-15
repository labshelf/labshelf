/**
 * Orchestrates the PDF import pipeline: collects every available signal, then merges them field by field.
 * Pdfjs bootstrap lives in the consumer package; core only sees the injected opener.
 */
import { detectIdentifiers, type DetectedIdentifier } from "../../identifiers/index.js";
import { isPdfBytes } from "../../../library/index.js";
import type { ILogger } from "../../../ports/index.js";
import { errorMessage } from "../../../logging/index.js";
import { resolveFirstIdentifier } from "../../lookup/index.js";
import { asString } from "../../metadata/index.js";
import { abstractFromText, titleFromPlainText } from "../frontMatter/index.js";
import { titleFromBlocks } from "../frontPageLayout.js";
import { isSparseText, looksLikeNaturalText, usableTitle } from "../quality/index.js";
import type { ParsedPdfImport, PdfDocumentOpener, PdfOcrEngine } from "../types.js";
import { resolveOnline, type ConfirmedIdentifier } from "./onlineRecord.js";
import { buildParsedRecord } from "./parsedRecord.js";
import { readPdf, type PdfSignals } from "./readPdf.js";
import { localSources } from "./signalSources.js";

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
    private readonly opener: PdfDocumentOpener,
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
    const embeddedIsReadable = looksLikeNaturalText(signals.frontMatter);
    let front = await this.readFrontMatter(pdfBytes, signals, embeddedIsReadable);
    let identification = await identify(signals, front.text, this.logger);

    const layoutTitle = embeddedIsReadable ? titleFromBlocks(signals.titleBlocks) : undefined;
    let localTitle: string | undefined = usableTitle(signals.xmp?.title) ?? usableTitle(asString(signals.info["Title"])) ?? layoutTitle;

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

    return assemble({ fileStem, signals, front, identification, embeddedIsReadable, layoutTitle, localTitle });
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
    return this.ocr.recognize(pdfBytes, OCR_PAGES).catch(() => "");
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
}

// Asks the registries about the paper, merges their answer with everything the file says itself, and grades it.
async function assemble(input: AssembleInput): Promise<ParsedPdfImport> {
  const { signals, front, identification, embeddedIsReadable } = input;
  const textIsReadable = embeddedIsReadable || looksLikeNaturalText(front.text);
  const abstract = textIsReadable ? abstractFromText(front.text) : undefined;
  // OCR text has no font sizes, so its title is a guess from line shape alone.
  const localTitle = input.localTitle ?? (textIsReadable ? front.ocrTitle : undefined);

  const frontMatter = front.text;
  const { confirmed } = identification;
  const online = await resolveOnline({ confirmed, signals, localTitle, frontMatter, abstract, usedOcr: front.usedOcr, textIsReadable });
  const local = localSources({ signals, frontMatter, abstract, layoutTitle: input.layoutTitle, ocrTitle: front.ocrTitle, embeddedIsReadable, textIsReadable });
  return buildParsedRecord({
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
    ocrTitle: usableTitle(titleFromPlainText(ocrText)),
  };
}

async function identify(signals: PdfSignals, frontMatter: string, logger: ILogger | undefined): Promise<Identification> {
  const identifiers = detectIdentifiers(signals.info, frontMatter, signals.linkUrls);
  const confirmed = await resolveFirstIdentifier(identifiers).catch(async (error: unknown) => {
    await logger?.log("WARN", PDF_PARSER_MODULE, "Identifier lookup failed; continuing without a confirmed identifier", {
      identifiers: identifiers.map((found) => found.value), message: errorMessage(error),
    });
    return undefined;
  });
  return { identifiers, confirmed };
}
