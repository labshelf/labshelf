// Declares the port for text embedding providers; apps implement it.
// INVARIANT: the pipeline depends only on the provider's declared dimensions, never on a model file.
export interface IEmbeddingProvider {
  readonly dimensions: number;
  readonly modelId: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}
