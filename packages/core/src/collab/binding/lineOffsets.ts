// Maps offsets between a document that may use CRLF line ends and the same text with only LF.
// ******************************************************************************
// Copied and adapted from open-collaboration-tools (yjs-normalized-text.ts).
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in LICENSE-open-collaboration-tools.md.
// ******************************************************************************

const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;

interface NormalizedLineOffset {
  normalized: number;
  offset: number;
}

const isEOL = (char: number): boolean => char === CARRIAGE_RETURN || char === LINE_FEED;

export function normalizeLineEnds(text: string, withCR: boolean): string {
  return text.replace(/\r?\n/g, withCR ? "\r\n" : "\n");
}

/**
 * Counts the LF-only offsets of `start` and `end` in `text` by scanning it, for use while the
 * text is being edited and no map of it exists. It is called about once per edit.
 */
export function countNormalizedOffsets(text: string, start: number, end: number): [number, number] {
  let normalizedStart = 0;
  let normalizedEnd = 0;
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) !== CARRIAGE_RETURN) {
      if (i < start) { normalizedStart++; }
      normalizedEnd++;
    }
  }
  return [normalizedStart, normalizedEnd];
}

function computeNormalizedLineOffsets(text: string): NormalizedLineOffset[] {
  const result: NormalizedLineOffset[] = [{ normalized: 0, offset: 0 }];
  let normalizationOffset = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (isEOL(ch)) {
      if (ch === CARRIAGE_RETURN && i + 1 < text.length && text.charCodeAt(i + 1) === LINE_FEED) {
        i++;
        normalizationOffset++;
      }
      const offset = i + 1;
      result.push({ normalized: offset - normalizationOffset, offset });
    }
  }
  return result;
}

export class LineOffsetMap {
  private readonly lines: NormalizedLineOffset[];

  constructor(text: string) {
    this.lines = computeNormalizedLineOffsets(text);
  }

  toDocumentOffset(normalizedOffset: number): number {
    const line = this.findLine(normalizedOffset, "normalized");
    return line.offset + normalizedOffset - line.normalized;
  }

  toNormalizedOffset(offset: number): number {
    const line = this.findLine(offset, "offset");
    return line.normalized + offset - line.offset;
  }

  private findLine(offset: number, key: keyof NormalizedLineOffset): NormalizedLineOffset {
    let low = 0;
    let high = this.lines.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.lines[mid]![key] > offset) { high = mid; } else { low = mid + 1; }
    }
    // INVARIANT: the first line starts at 0 and offsets are not negative, so low is at least 1.
    // low is the first line that starts after the offset, so the offset lies on the line before it.
    return this.lines[low - 1]!;
  }
}
