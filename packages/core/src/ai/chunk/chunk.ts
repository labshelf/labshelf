// Defines the paper chunk, the unit of embedding produced during ingestion.

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
