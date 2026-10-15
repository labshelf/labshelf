// Describes the citation graph and the stance each citation takes toward the cited claim.

export type Stance = "support" | "contradict" | "neutral";

export interface CitationNode {
  paperId: string;
  title: string;
  year?: number;
  isLocal: boolean;
}

export interface CitationEdge {
  fromPaperId: string;
  toPaperId: string;
  stance?: Stance;
  contextSnippet?: string;
}

export interface ClaimSearchResult {
  paperId: string;
  stance: Stance;
  score: number;
  bestSnippet: string;
  page?: number;
}
