// Declares the vector store port: top-k retrieval with metadata filtering.
export interface VectorEntry {
  id: number;
  paperId: string;
  kind: string;
  section?: string;
  page?: number;
  text?: string;
}

export interface VectorMatch extends VectorEntry {
  score: number;
}

export interface VectorFilter {
  paperIds?: string[];
  kinds?: string[];
  excludePaperIds?: string[];
}

export interface IVectorStore {
  upsert(records: { record: VectorEntry; embedding: Float32Array }[]): Promise<void>;
  search(embedding: Float32Array, k: number, filter?: VectorFilter): Promise<VectorMatch[]>;
  deleteByPaper(paperId: string): Promise<void>;
}
