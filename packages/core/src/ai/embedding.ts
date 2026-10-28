// Embedding: the provider and vector-store ports, the model-free hash provider, and cosine similarity over Float32Array vectors.
// INVARIANT: the pipeline depends only on the provider's declared dimensions, never on a model file.
export interface IEmbeddingProvider {
  readonly dimensions: number;
  readonly modelId: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

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

// --- Hash provider ---


const TOKEN_RE = /[A-Za-z][A-Za-z0-9'-]{1,}/g;

export class HashEmbeddingProvider implements IEmbeddingProvider {
  readonly modelId = "labshelf/hash-bow-384";
  readonly dimensions: number;

  constructor(dimensions = 384) {
    this.dimensions = dimensions;
  }

  /**
   * Produces a deterministic bag-of-words pseudo-embedding for each text.
   */
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): Float32Array {
    const vec = new Float32Array(this.dimensions);
    const tokens = text.toLowerCase().match(TOKEN_RE) ?? [];
    for (const token of tokens) {
      const bucket = hash(token) % this.dimensions;
      vec[bucket] = (vec[bucket] ?? 0) + 1;
    }
    return l2Normalise(vec);
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function l2Normalise(v: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += (v[i] ?? 0) ** 2;
  if (sumSq === 0) return v;
  const norm = Math.sqrt(sumSq);
  for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm;
  return v;
}

// --- Cosine similarity ---


/**
 * Cosine similarity between two equal-length vectors.
 *
 * @returns Value in [-1, 1].
 */
export function deriveCosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dimension mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}
