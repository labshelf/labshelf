/**
 * Tests commitChart (plan charts, spec 3.3, D4/D5): the step openChartEditor runs on Ok and Apply before it hands the block to
 * the note. A large table goes to assets/<id>.csv through the port first and the model comes back with src set and data removed;
 * a failing write returns the error and no model; a small table, or no port, stays inline.
 */
import type { ChartModel, ChartTable } from "../../../../src/qmd/chart/model";
import type { NoteFilesPort } from "../../../../src/qmd/noteFiles";
import { commitChart } from "../../../../src/qmd/dom/figureEditor/openFigureEditor";

const ROWS = 3500;
const SMALL: ChartTable = { cols: [{ name: "t", values: [1, 2, 3] }, { name: "v", values: [10, 20, 30] }] };
const LARGE: ChartTable = {
  cols: [
    { name: "t", values: Array.from({ length: ROWS }, (_, i) => 1000000.5 + i) },
    { name: "v", values: Array.from({ length: ROWS }, (_, i) => 2000000.5 + i) },
  ],
};

function chartModel(data: ChartTable): ChartModel {
  return {
    v: 1,
    id: "a1b2c3d4",
    kind: "data",
    data,
    traces: [{ type: "scatter", x: "A", y: "B", mode: "lines" }],
    fns: [],
    vars: [],
    layout: { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } },
  };
}

interface Files { port: NoteFilesPort; write: jest.Mock<Promise<void>, [string, Uint8Array]>; log: string[] }

function fakeFiles(write: () => Promise<void> = async () => undefined, log: string[] = []): Files {
  const writeMock = jest.fn(async (_path: string, _bytes: Uint8Array) => { log.push("write-start"); await write(); log.push("write-end"); });
  return { port: { read: async () => null, write: writeMock, pickTextFile: async () => null }, write: writeMock, log };
}

const textOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf8");

describe("commitChart with a port", () => {
  it("3.3c a large table is written to assets/<id>.csv as UTF-8 CSV", async () => {
    expect(JSON.stringify(chartModel(LARGE)).length).toBeGreaterThan(70000);
    const files = fakeFiles();
    await commitChart(chartModel(LARGE), LARGE, files.port);
    expect(files.write).toHaveBeenCalledTimes(1);
    const [path, bytes] = files.write.mock.calls[0]!;
    expect(path).toBe("assets/a1b2c3d4.csv");
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    const lines = textOf(bytes).trim().split(/\r?\n/);
    expect(lines.length).toBeGreaterThanOrEqual(ROWS);
    expect(lines.length).toBeLessThanOrEqual(ROWS + 1);
    expect(lines[lines.length - 1]).toContain(String(1000000.5 + ROWS - 1));
  });

  it("3.3c returns the model with src set and data removed, and no error", async () => {
    const result = await commitChart(chartModel(LARGE), LARGE, fakeFiles().port);
    expect(result.error).toBeNull();
    expect(result.model).not.toBeNull();
    expect(result.model!.src).toBe("assets/a1b2c3d4.csv");
    expect(result.model!.data).toBeUndefined();
    expect(result.model!.id).toBe("a1b2c3d4");
    expect(result.model!.traces).toEqual(chartModel(LARGE).traces);
  });

  it("3.3c resolves only after the write has finished", async () => {
    let finish: () => void = () => undefined;
    const files = fakeFiles(() => new Promise<void>((resolve) => { finish = resolve; }));
    let resolved = false;
    const pending = commitChart(chartModel(LARGE), LARGE, files.port).then((result) => { resolved = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(files.write).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
    finish();
    const result = await pending;
    expect(result.model?.src).toBe("assets/a1b2c3d4.csv");
  });

  it("3.3c a failing write returns the error message and no model", async () => {
    const files = fakeFiles(async () => { throw new Error("disk full"); });
    const result = await commitChart(chartModel(LARGE), LARGE, files.port);
    expect(files.write).toHaveBeenCalledTimes(1);
    expect(result.model).toBeNull();
    expect(result.error).toContain("disk full");
  });

  it("3.3c a small table stays inline and the port is not touched", async () => {
    const files = fakeFiles();
    const result = await commitChart(chartModel(SMALL), SMALL, files.port);
    expect(files.write).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
    expect(result.model!.data).toEqual(SMALL);
    expect(result.model!.src).toBeUndefined();
  });
});

describe("commitChart without a port", () => {
  it("3.3c a large table stays inline", async () => {
    const result = await commitChart(chartModel(LARGE), LARGE, undefined);
    expect(result.error).toBeNull();
    expect(result.model!.src).toBeUndefined();
    expect(result.model!.data?.cols[0]?.values).toHaveLength(ROWS);
  });

  it("3.3c a small table stays inline", async () => {
    const result = await commitChart(chartModel(SMALL), SMALL, undefined);
    expect(result.error).toBeNull();
    expect(result.model!.data).toEqual(SMALL);
  });
});
