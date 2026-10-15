// Declares the vector store port: top-k retrieval with metadata filtering.
export interface VectorRecord {
  id: number;
  paperId: string;
  kind: string;
  section?: string;
  page?: number;
  text?: string;
}

export interface VectorMatch extends VectorRecord {
  score: number;
}

export interface VectorFilter {
  paperIds?: string[];
  kinds?: string[];
  excludePaperIds?: string[];
}

export interface IVectorStore {
  upsert(records: { record: VectorRecord; embedding: Float32Array }[]): Promise<void>;
  search(embedding: Float32Array, k: number, filter?: VectorFilter): Promise<VectorMatch[]>;
  deleteByPaper(paperId: string): Promise<void>;
}
