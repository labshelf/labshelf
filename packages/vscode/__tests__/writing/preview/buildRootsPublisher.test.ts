// Pins that the measure cache takes each measure once per root until the root is invalidated.
import { MeasureCache } from "../../../src/writing/preview/buildRootsPublisher.js";

describe("MeasureCache", () => {
  it("reuses the cached promise for the same root and kind", async () => {
    const cache = new MeasureCache();
    const measure = jest.fn(async () => 1);
    const first = cache.get("/p", "a.tex", "words", measure);
    const second = cache.get("/p", "a.tex", "words", measure);
    expect(second).toBe(first);
    expect(await first).toBe(1);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("invalidate re-measures that root only", async () => {
    const cache = new MeasureCache();
    const measure = jest.fn(async () => 1);
    await cache.get("/p", "a.tex", "words", measure);
    await cache.get("/p", "a.tex", "cites", measure);
    await cache.get("/p", "b.tex", "words", measure);
    measure.mockClear();
    cache.invalidate("/p", "a.tex");
    await cache.get("/p", "a.tex", "words", measure);
    await cache.get("/p", "a.tex", "cites", measure);
    await cache.get("/p", "b.tex", "words", measure);
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("clear re-measures every root", async () => {
    const cache = new MeasureCache();
    const measure = jest.fn(async () => 1);
    await cache.get("/p", "a.tex", "words", measure);
    await cache.get("/q", "b.tex", "words", measure);
    measure.mockClear();
    cache.clear();
    await cache.get("/p", "a.tex", "words", measure);
    await cache.get("/q", "b.tex", "words", measure);
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("retries a measure that rejected", async () => {
    const cache = new MeasureCache();
    const measure = jest.fn<Promise<number>, []>().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(2);
    await expect(cache.get("/p", "a.tex", "words", measure)).rejects.toThrow("boom");
    await Promise.resolve();
    await expect(cache.get("/p", "a.tex", "words", measure)).resolves.toBe(2);
    expect(measure).toHaveBeenCalledTimes(2);
  });
});
