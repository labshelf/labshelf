// Tests the cross-process lock that serialises every change to the shared managed TeX.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { withTexLock } from "../../../../../../src/writing/latex/toolchain/node/managed/index";
import { asLogger, createTexFixture, type TexFixture } from "./fakeTex";

let fx: TexFixture;
let lockFile: string;
beforeEach(async () => { fx = await createTexFixture(); lockFile = join(fx.texRoot, ".lock"); });
afterEach(() => fx.cleanup());

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fast = { pollMs: 10 };

describe("withTexLock", () => {
  it("runs two concurrent operations without overlap", async () => {
    // Which one gets the lock first is not defined, so only the intervals are compared.
    const spans: Array<{ name: string; enter: number; exit: number }> = [];
    const step = (name: string) => async () => {
      const enter = performance.now();
      await delay(30);
      spans.push({ name, enter, exit: performance.now() });
      return name;
    };
    const results = await Promise.all([
      withTexLock(fx.texRoot, "first", asLogger(fx.logger), step("a"), fast),
      withTexLock(fx.texRoot, "second", asLogger(fx.logger), step("b"), fast),
    ]);
    expect([...results].sort()).toEqual(["a", "b"]);
    expect(spans).toHaveLength(2);
    const [early, late] = [...spans].sort((x, y) => x.enter - y.enter);
    expect(early?.exit).toBeLessThanOrEqual(late?.enter ?? -1);
  });

  it("writes the holder's pid and operation while it runs", async () => {
    await withTexLock(fx.texRoot, "install tinytex", asLogger(fx.logger), async () => {
      expect(JSON.parse(await readFile(lockFile, "utf8"))).toMatchObject({ pid: process.pid, operation: "install tinytex" });
    });
  });

  it("takes over a lock whose process is gone and logs it", async () => {
    await mkdir(fx.texRoot, { recursive: true });
    const stale = JSON.stringify({ pid: 999999, operation: "install texlive", startedAt: "2026-01-01T00:00:00.000Z" });
    await writeFile(lockFile, stale);
    const isAlive = (pid: number) => pid === process.pid;
    expect(await withTexLock(fx.texRoot, "install tinytex", asLogger(fx.logger), async () => "ran", { ...fast, isAlive })).toBe("ran");
    const warn = fx.logger.log.mock.calls.find((call) => call[0] === "WARN");
    expect(JSON.stringify(warn)).toContain("install texlive");
  });

  it("takes over a garbled lock older than the timeout", async () => {
    await mkdir(fx.texRoot, { recursive: true });
    await writeFile(lockFile, "{not json");
    await delay(30);
    expect(await withTexLock(fx.texRoot, "install tinytex", asLogger(fx.logger), async () => "ran", { pollMs: 5, timeoutMs: 20 })).toBe("ran");
  });

  it("gives up after the timeout, naming its operation and the holder", async () => {
    await mkdir(fx.texRoot, { recursive: true });
    await writeFile(lockFile, JSON.stringify({ pid: process.pid, operation: "install texlive", startedAt: new Date().toISOString() }));
    const run = jest.fn(async () => undefined);
    const attempt = withTexLock(fx.texRoot, "install missing foo.sty", asLogger(fx.logger), run, { pollMs: 5, timeoutMs: 40 });
    await expect(attempt).rejects.toThrow(/install missing foo\.sty[\s\S]*install texlive/);
    expect(run).not.toHaveBeenCalled();
  });

  it("removes its lock after a run and after a run that throws", async () => {
    await withTexLock(fx.texRoot, "ok", asLogger(fx.logger), async () => undefined);
    expect(existsSync(lockFile)).toBe(false);
    await expect(withTexLock(fx.texRoot, "boom", asLogger(fx.logger), async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(lockFile)).toBe(false);
  });
});
