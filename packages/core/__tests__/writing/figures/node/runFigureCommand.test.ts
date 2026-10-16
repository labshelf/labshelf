/** Verifies the figure command runner: shell, working folder, exit codes, streaming and cancellation. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { runFigureCommand } from "../../../../src/writing/figures/node/index";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

describe("runFigureCommand", () => {
  it("runs a shell command line with a pipe in the project folder", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "marker.txt"), "x");
    const result = await runFigureCommand({ command: "ls | grep marker && pwd", cwd: dir, signal: new AbortController().signal });
    expect(result.status).toBe("finished");
    if (result.status !== "finished") { return; }
    expect(result.code).toBe(0);
    expect(result.output).toContain("marker.txt");
    expect(result.output).toContain(dir);
  });

  it("returns the exit code and output of a failing command instead of rejecting", async () => {
    const dir = await makeTempDir();
    const result = await runFigureCommand({ command: "echo boom >&2; exit 3", cwd: dir, signal: new AbortController().signal });
    expect(result).toEqual({ status: "finished", code: 3, output: "boom\n" });
  });

  it("streams output to the callback as it arrives", async () => {
    const dir = await makeTempDir();
    const chunks: string[] = [];
    await runFigureCommand({ command: "echo one; echo two", cwd: dir, signal: new AbortController().signal, onOutput: (c) => chunks.push(c) });
    expect(chunks.join("")).toBe("one\ntwo\n");
  });

  it("stops a running command when aborted", async () => {
    const dir = await makeTempDir();
    const controller = new AbortController();
    const started = Date.now();
    const running = runFigureCommand({ command: "sleep 30", cwd: dir, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    expect(await running).toEqual({ status: "cancelled" });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("does not start when already aborted", async () => {
    const dir = await makeTempDir();
    const controller = new AbortController();
    controller.abort();
    expect(await runFigureCommand({ command: "touch ran", cwd: dir, signal: controller.signal })).toEqual({ status: "cancelled" });
    await expect(fs.stat(path.join(dir, "ran"))).rejects.toThrow();
  });
});
