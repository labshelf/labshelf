import { concurrencyLimit as limit } from "../../../src/library/scan/concurrencyLimit";

describe("concurrencyLimit", () => {
  it("never runs more than max tasks at once and finishes them all", async () => {
    const run = limit(3);
    let running = 0;
    let peak = 0;
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => run(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running--;
      return i;
    })));
    expect(peak).toBe(3);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("keeps going after a task fails", async () => {
    const run = limit(1);
    const failing = run(async () => { throw new Error("boom"); });
    const next = run(async () => "ok");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
