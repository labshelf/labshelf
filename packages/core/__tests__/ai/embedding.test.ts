// The hash embedding provider and cosine similarity.
import { HashEmbeddingProvider, deriveCosine } from "../../src/ai/embedding";

describe("HashEmbeddingProvider", () => {
  it("returns one vector per input", async () => {
    const provider = new HashEmbeddingProvider(64);
    const vectors = await provider.embed(["alpha beta", "gamma delta"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]!.length).toBe(64);
  });

  it("is deterministic", async () => {
    const provider = new HashEmbeddingProvider(32);
    const [a] = await provider.embed(["the quick brown fox"]);
    const [b] = await provider.embed(["the quick brown fox"]);
    expect(Array.from(a!)).toEqual(Array.from(b!));
  });

  it("produces L2-normalised vectors", async () => {
    const provider = new HashEmbeddingProvider(32);
    const [v] = await provider.embed(["alpha beta gamma"]);
    let sq = 0;
    for (const x of v!) sq += x * x;
    expect(Math.sqrt(sq)).toBeCloseTo(1, 5);
  });

  it("returns a zero vector for empty input", async () => {
    const provider = new HashEmbeddingProvider(8);
    const [v] = await provider.embed([""]);
    for (const x of v!) expect(x).toBe(0);
  });
});

describe("cosine", () => {
  it("returns 1 for identical vectors", () => {
    const v = new Float32Array([1, 0, 0]);
    expect(deriveCosine(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(deriveCosine(a, b)).toBeCloseTo(0, 5);
  });

  it("throws on dimension mismatch", () => {
    expect(() => deriveCosine(new Float32Array([1]), new Float32Array([1, 2]))).toThrow();
  });

  it("returns 0 for a zero vector", () => {
    expect(deriveCosine(new Float32Array([0, 0]), new Float32Array([1, 2]))).toBe(0);
  });
});
