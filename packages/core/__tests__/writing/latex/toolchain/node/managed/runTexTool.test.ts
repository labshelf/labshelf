import { join } from "node:path";

import { progressFraction, runTexTool } from "../../../../../../src/writing/latex/toolchain/node/managed/index";
import { asLogger, createTexFixture, writeTexTree, type TexFixture } from "./fakeTex";

describe("progressFraction", () => {
  it("reads the last [n/total, counter of a chunk", () => {
    expect(progressFraction("[1/4, 00:00/00:00] install: a [1k]\n[3/4, 00:01/00:02] install: c [1k]\n")).toBe(0.75);
  });

  it("is null for output without a counter", () => {
    expect(progressFraction("tlmgr: package repository https://x (verified)\n")).toBeNull();
  });
});

describe("runTexTool", () => {
  let fixture: TexFixture;
  beforeEach(async () => { fixture = await createTexFixture(); });
  afterEach(() => fixture.cleanup());

  it("runs the tool, logs its exit code and reports progress", async () => {
    const bin = await writeTexTree(join(fixture.texRoot, "tinytex"), 2026, fixture.callsFile, { rollover: false, installed: [] });
    const fractions: number[] = [];
    const outcome = await runTexTool({
      executable: join(bin, "tlmgr"), args: ["install", "a", "b"], cwd: bin, logger: asLogger(fixture.logger),
      onProgress: (fraction) => fractions.push(fraction),
    });
    expect(outcome.code).toBe(0);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(fixture.logger.log).toHaveBeenCalledWith("INFO", expect.any(String), expect.any(String), expect.objectContaining({ code: 0 }));
  });
});
