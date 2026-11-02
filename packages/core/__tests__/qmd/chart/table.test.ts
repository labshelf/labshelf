// Tests columnLetter and placeTable (plan charts, spec 3.1, D4): spreadsheet column letters and the inline-or-external rule for a chart's table.
import { emptyChart } from "../../../src/qmd/chart/model";
import type { ChartModel, ChartTable } from "../../../src/qmd/chart/model";
import { parseCsv } from "../../../src/qmd/chart/csv";
import { columnLetter, placeTable } from "../../../src/qmd/chart/table";

const ID = "0a1b2c3d";
const LIMIT = 65536;

function bytes(model: ChartModel, table: ChartTable): number {
  return Buffer.byteLength(JSON.stringify({ ...model, data: table }), "utf8");
}

function textTable(text: string): ChartTable {
  return { cols: [{ name: "t", values: [text] }] };
}

/** A one-cell text table whose model JSON is exactly `target` bytes (ASCII). */
function tableOfSize(model: ChartModel, target: number): ChartTable {
  const base = bytes(model, textTable(""));
  return textTable("a".repeat(target - base));
}

describe("columnLetter", () => {
  it("3.1c names the first columns A, B, C", () => {
    expect([0, 1, 2].map(columnLetter)).toEqual(["A", "B", "C"]);
  });

  it("3.1c ends the single letters at Z and continues with AA, AB", () => {
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
  });

  it("3.1c rolls over at AZ to BA and at ZZ to AAA", () => {
    expect(columnLetter(51)).toBe("AZ");
    expect(columnLetter(52)).toBe("BA");
    expect(columnLetter(701)).toBe("ZZ");
    expect(columnLetter(702)).toBe("AAA");
  });
});

describe("placeTable", () => {
  it("3.1c keeps a small table inline: data set, no src, no csv", () => {
    const model = emptyChart("data", ID);
    const table: ChartTable = { cols: [{ name: "x", values: [1, 2, 3] }, { name: "y", values: [4, null, "n/a"] }] };
    const r = placeTable(model, table);
    expect(r.csv).toBeNull();
    expect(r.model.data).toEqual(table);
    expect(r.model.src).toBeUndefined();
    expect("src" in r.model).toBe(false);
  });

  it("3.1c moves a large table to assets/<id>.csv with src set and data removed", () => {
    const model = emptyChart("data", ID);
    const n = 20000;
    const table: ChartTable = {
      cols: [
        { name: "x", values: Array.from({ length: n }, (_, i) => i) },
        { name: "y", values: Array.from({ length: n }, (_, i) => i * 0.5) },
      ],
    };
    expect(bytes(model, table)).toBeGreaterThan(LIMIT);
    const r = placeTable(model, table);
    expect(r.model.src).toBe(`assets/${ID}.csv`);
    expect("data" in r.model).toBe(false);
    expect(r.csv).not.toBeNull();
    expect(r.csv?.path).toBe(`assets/${ID}.csv`);
  });

  it("3.1c returns csv text that parses back to the large table", () => {
    const model = emptyChart("data", ID);
    const n = 20000;
    const table: ChartTable = {
      cols: [
        { name: "x", values: Array.from({ length: n }, (_, i) => i) },
        { name: "y", values: Array.from({ length: n }, (_, i) => i * 0.5) },
      ],
    };
    const r = placeTable(model, table);
    expect(parseCsv(r.csv?.text ?? "").table).toEqual(table);
  });

  it("3.1c leaves the other model fields as they were", () => {
    const model: ChartModel = { ...emptyChart("data", ID), title: "T", traces: [{ type: "scatter", x: "A", y: "B" }] };
    const big = placeTable(model, tableOfSize(model, LIMIT + 10));
    const small = placeTable(model, textTable("s"));
    for (const r of [big, small]) {
      expect(r.model.id).toBe(ID);
      expect(r.model.title).toBe("T");
      expect(r.model.traces).toEqual(model.traces);
      expect(r.model.layout).toEqual(model.layout);
    }
  });

  it("3.1c keeps inline a table whose model JSON is 65535 bytes", () => {
    const model = emptyChart("data", ID);
    const table = tableOfSize(model, LIMIT - 1);
    expect(bytes(model, table)).toBe(LIMIT - 1);
    const r = placeTable(model, table);
    expect(r.csv).toBeNull();
    expect(r.model.data).toEqual(table);
  });

  it("3.1c moves to a csv a table whose model JSON reaches 65536 bytes", () => {
    const model = emptyChart("data", ID);
    const table = tableOfSize(model, LIMIT);
    expect(bytes(model, table)).toBe(LIMIT);
    const r = placeTable(model, table);
    expect(r.csv?.path).toBe(`assets/${ID}.csv`);
    expect(r.model.src).toBe(`assets/${ID}.csv`);
    expect("data" in r.model).toBe(false);
  });

  it("3.1c counts UTF-8 bytes, not characters", () => {
    const model = emptyChart("data", ID);
    const table = textTable("é".repeat(40000));
    expect(JSON.stringify({ ...model, data: table }).length).toBeLessThan(LIMIT);
    expect(bytes(model, table)).toBeGreaterThan(LIMIT);
    const r = placeTable(model, table);
    expect(r.model.src).toBe(`assets/${ID}.csv`);
    expect(r.csv).not.toBeNull();
  });

  it("3.1c returns a model with src to inline when the new table is small", () => {
    const external: ChartModel = { ...emptyChart("data", ID), src: `assets/${ID}.csv` };
    delete external.data;
    const table: ChartTable = { cols: [{ name: "x", values: [1, 2] }] };
    const r = placeTable(external, table);
    expect(r.csv).toBeNull();
    expect(r.model.data).toEqual(table);
    expect("src" in r.model).toBe(false);
  });

  it("3.1c names the csv after the model id", () => {
    const model = emptyChart("data", "ffffffff");
    const r = placeTable(model, tableOfSize(model, LIMIT + 100));
    expect(r.csv?.path).toBe("assets/ffffffff.csv");
    expect(r.model.src).toBe("assets/ffffffff.csv");
  });
});
