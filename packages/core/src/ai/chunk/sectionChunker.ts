// Builds embedding-ready chunks from detected sections.
// Sections over the token budget are split on paragraph boundaries.
import type {
  ExtractedPdfText,
  PaperChunk,
  PaperSection,
} from "./chunk.js";
import { detectSections } from "./sectionDetector.js";
import { charsForTokenBudget, estimateTokens } from "./tokenEstimator.js";

const CHUNK_CHAR_BUDGET = charsForTokenBudget(384);

/**
 * Produces section-scoped chunks ready for embedding.
 *
 * @returns Ordered list of PaperChunk records.
 */
export function chunkBySection(extracted: ExtractedPdfText): PaperChunk[] {
  const sections = extracted.sections.length
    ? extracted.sections
    : detectSections(extracted.pages);
  if (sections.length === 0) {
    return chunkByPage(extracted);
  }
  const chunks: PaperChunk[] = [];
  for (const section of sections) {
    chunks.push(...splitSection(extracted.paperId, section));
  }
  return chunks;
}

function splitSection(paperId: string, section: PaperSection): PaperChunk[] {
  if (section.text.length <= CHUNK_CHAR_BUDGET) {
    return [
      {
        paperId,
        kind: "section",
        section: section.heading,
        page: section.page,
        startOffset: section.startOffset,
        endOffset: section.endOffset,
        text: section.text,
        tokenCount: estimateTokens(section.text),
      },
    ];
  }
  return splitOnParagraphs(paperId, section, CHUNK_CHAR_BUDGET);
}

function splitOnParagraphs(
  paperId: string,
  section: PaperSection,
  budget: number,
): PaperChunk[] {
  const paragraphs = section.text.split(/\n{2,}/);
  const chunks: PaperChunk[] = [];
  let buffer = "";
  let bufferStart = section.startOffset;
  let cursor = section.startOffset;
  for (const para of paragraphs) {
    const next = buffer ? buffer + "\n\n" + para : para;
    if (next.length > budget && buffer) {
      chunks.push(buildChunk(paperId, section, bufferStart, cursor, buffer));
      buffer = "";
      bufferStart = cursor;
    }
    if (para.length > budget) {
      for (const piece of hardSplit(para, budget)) {
        chunks.push(
          buildChunk(paperId, section, bufferStart, bufferStart + piece.length, piece),
        );
        bufferStart += piece.length;
      }
      buffer = "";
    } else {
      buffer = buffer ? buffer + "\n\n" + para : para;
    }
    cursor += para.length + 2;
  }
  if (buffer) {
    chunks.push(buildChunk(paperId, section, bufferStart, cursor, buffer));
  }
  return chunks;
}

function hardSplit(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += budget) out.push(text.slice(i, i + budget));
  return out;
}

function buildChunk(
  paperId: string,
  section: PaperSection,
  start: number,
  end: number,
  text: string,
): PaperChunk {
  return {
    paperId,
    kind: "section",
    section: section.heading,
    page: section.page,
    startOffset: start,
    endOffset: end,
    text,
    tokenCount: estimateTokens(text),
  };
}

function chunkByPage(extracted: ExtractedPdfText): PaperChunk[] {
  let offset = 0;
  const out: PaperChunk[] = [];
  for (const p of extracted.pages) {
    const text = p.text.length > CHUNK_CHAR_BUDGET ? p.text.slice(0, CHUNK_CHAR_BUDGET) : p.text;
    out.push({
      paperId: extracted.paperId,
      kind: "section",
      page: p.page,
      startOffset: offset,
      endOffset: offset + text.length,
      text,
      tokenCount: estimateTokens(text),
    });
    offset += p.text.length;
  }
  return out;
}
