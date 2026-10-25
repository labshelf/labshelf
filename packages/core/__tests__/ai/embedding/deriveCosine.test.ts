import { deriveCosine } from "../../../src/ai/embedding/index.js";

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
