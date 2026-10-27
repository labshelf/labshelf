// Chunks a paper's extracted text for embedding: the chunk types, section detection, section-scoped splitting and token estimates.
// Sections over the token budget are split on paragraph boundaries.

export type ChunkKind = "section" | "sliding" | "title" | "abstract";

export interface PaperChunk {
  paperId: string;
  kind: ChunkKind;
  section?: string;
  page?: number;
  startOffset: number;
  endOffset: number;
  text: string;
  tokenCount: number;
  embedding?: Float32Array;
}

export interface PaperSection {
  heading: string;
  page: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface ExtractedPdfText {
  paperId: string;
  pages: { page: number; text: string }[];
  sections: PaperSection[];
}

// --- Token estimate ---

// ~4 chars per token approximates English academic text; real tokenizers belong to embedding providers.
const CHARS_PER_TOKEN = 4;

/**
 * Approximate token count from a UTF-16 string.
 *
 * @returns Estimated token count, rounded up.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Inverse of estimateTokens — character budget for a given token target.
 *
 * @returns Character count corresponding to maxTokens.
 */
export function deriveCharsForTokenBudget(maxTokens: number): number {
  return Math.max(1, Math.floor(maxTokens * CHARS_PER_TOKEN));
}

// --- Section detection ---

const NUMBERED = /^\s{0,4}(\d{1,2}(?:\.\d{1,2}){0,2})\s+([A-Z][^\n]{2,80})$/gm;
const NAMED = /^\s{0,4}(Abstract|Introduction|Background|Related Work|Methods?|Methodology|Approach|Experiments?|Results?|Evaluation|Discussion|Conclusions?|References|Acknowledgements?|Limitations?)\s*$/gim;

interface HeadingMatch {
  heading: string;
  offset: number;
  page: number;
}

/**
 * Locates section headings in the merged text of a paper.
 *
 * @returns Sorted, non-overlapping list of sections with their text spans.
 */
export function detectSections(
  pages: { page: number; text: string }[],
): PaperSection[] {
  const merged = mergePages(pages);
  const matches = collectMatches(merged.text);
  matches.sort((a, b) => a.offset - b.offset);
  return materializeSections(matches, merged);
}

function mergePages(pages: { page: number; text: string }[]): {
  text: string;
  pageBreaks: { offset: number; page: number }[];
} {
  let text = "";
  const pageBreaks: { offset: number; page: number }[] = [];
  for (const p of pages) {
    pageBreaks.push({ offset: text.length, page: p.page });
    text += p.text + "\n";
  }
  return { text, pageBreaks };
}

function collectMatches(text: string): HeadingMatch[] {
  const found: HeadingMatch[] = [];
  for (const m of text.matchAll(NUMBERED)) {
    if (m.index === undefined) continue;
    found.push({ heading: `${m[1]} ${m[2]}`.trim(), offset: m.index, page: 0 });
  }
  for (const m of text.matchAll(NAMED)) {
    if (m.index === undefined) continue;
    found.push({ heading: (m[1] ?? "").trim(), offset: m.index, page: 0 });
  }
  return dedupeByOffset(found);
}

function dedupeByOffset(items: HeadingMatch[]): HeadingMatch[] {
  const seen = new Set<number>();
  return items.filter((it) => {
    if (seen.has(it.offset)) return false;
    seen.add(it.offset);
    return true;
  });
}

function materializeSections(
  matches: HeadingMatch[],
  merged: { text: string; pageBreaks: { offset: number; page: number }[] },
): PaperSection[] {
  if (matches.length === 0) return [];
  const sections: PaperSection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    if (!cur) continue;
    const next = matches[i + 1];
    const start = cur.offset;
    const end = next ? next.offset : merged.text.length;
    sections.push({
      heading: cur.heading,
      page: pageForOffset(start, merged.pageBreaks),
      startOffset: start,
      endOffset: end,
      text: merged.text.slice(start, end).trim(),
    });
  }
  return sections;
}

function pageForOffset(
  offset: number,
  pageBreaks: { offset: number; page: number }[],
): number {
  let current = 1;
  for (const br of pageBreaks) {
    if (br.offset <= offset) current = br.page;
    else break;
  }
  return current;
}

// --- Section chunking ---

const CHUNK_CHAR_BUDGET = deriveCharsForTokenBudget(384);

/**
 * Produces section-scoped chunks ready for embedding.
 *
 * @returns Ordered list of PaperChunk records.
 */
export function splitBySection(extracted: ExtractedPdfText): PaperChunk[] {
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
        tokenCount: countTokens(section.text),
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
    tokenCount: countTokens(text),
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
      tokenCount: countTokens(text),
    });
    offset += p.text.length;
  }
  return out;
}
