// Tests parseCsv and formatCsv (plan charts, spec 3.1, D4): RFC 4180 parsing with delimiter sniffing, typed cells, header detection and a stable format-back to CSV.
import { formatCsv, parseCsv } from "../../../src/qmd/chart/csv";
import type { ChartTable } from "../../../src/qmd/chart/model";

function names(table: ChartTable): string[] {
  return table.cols.map((c) => c.name);
}

function values(table: ChartTable): (number | string | null)[][] {
  return table.cols.map((c) => c.values);
}

describe("parseCsv", () => {
  it("3.1a reads a plain comma file with a header into typed columns", () => {
    const r = parseCsv("x,y\n1,2\n3,4.5\n");
    expect(r.delimiter).toBe(",");
    expect(r.header).toBe(true);
    expect(r.errors).toEqual([]);
    expect(names(r.table)).toEqual(["x", "y"]);
    expect(values(r.table)).toEqual([[1, 3], [2, 4.5]]);
  });

  it("3.1a reads empty cells as null, numbers as numbers and other text as strings", () => {
    const r = parseCsv("x,y,z\n1,,a\n2,n/a,3\n");
    expect(values(r.table)).toEqual([[1, 2], [null, "n/a"], ["a", 3]]);
  });

  it("3.1a reads quoted fields holding the delimiter", () => {
    const r = parseCsv('n,note\n1,"a,b"\n2,plain\n');
    expect(r.delimiter).toBe(",");
    expect(values(r.table)[1]).toEqual(["a,b", "plain"]);
  });

  it("3.1a reads doubled quotes inside a quoted field as one quote", () => {
    const r = parseCsv('n,note\n1,"say ""hi"""\n');
    expect(values(r.table)[1]).toEqual(['say "hi"']);
  });

  it("3.1a reads a newline embedded in a quoted field", () => {
    const r = parseCsv('n,note\n1,"line1\nline2"\n2,after\n');
    expect(values(r.table)[0]).toEqual([1, 2]);
    expect(values(r.table)[1]).toEqual(["line1\nline2", "after"]);
  });

  it("3.1a reads CRLF line endings", () => {
    const r = parseCsv("x,y\r\n1,2\r\n3,4\r\n");
    expect(names(r.table)).toEqual(["x", "y"]);
    expect(values(r.table)).toEqual([[1, 3], [2, 4]]);
  });

  it("3.1a drops a leading BOM", () => {
    const r = parseCsv("﻿x,y\n1,2\n");
    expect(names(r.table)).toEqual(["x", "y"]);
    expect(values(r.table)).toEqual([[1], [2]]);
  });

  it("3.1a sniffs a semicolon file and reads comma decimals as numbers", () => {
    const r = parseCsv("x;y\n1,5;2,25\n3;4,5\n");
    expect(r.delimiter).toBe(";");
    expect(names(r.table)).toEqual(["x", "y"]);
    expect(values(r.table)).toEqual([[1.5, 3], [2.25, 4.5]]);
  });

  it("3.1a sniffs a tab file", () => {
    const r = parseCsv("x\ty\n1\t2\n3\t4\n");
    expect(r.delimiter).toBe("\t");
    expect(names(r.table)).toEqual(["x", "y"]);
    expect(values(r.table)).toEqual([[1, 3], [2, 4]]);
  });

  it("3.1a pads a ragged row with empty cells", () => {
    const r = parseCsv("a,b,c\n1,2,3\n4,5\n");
    expect(r.table.cols).toHaveLength(3);
    expect(values(r.table)).toEqual([[1, 4], [2, 5], [3, null]]);
  });

  it("3.1a formatCsv(parseCsv(x)) is stable for comma, quoted and multi-line input", () => {
    const x = 'n,note,v\r\n1,"a,b",2.5\r\n2,"say ""hi""",\r\n3,"l1\nl2",7\r\n';
    const once = formatCsv(parseCsv(x).table);
    const again = formatCsv(parseCsv(once).table);
    expect(again).toBe(once);
    expect(parseCsv(once).table).toEqual(parseCsv(x).table);
  });

  it("3.1a formatCsv(parseCsv(x)) is stable for semicolon and tab input", () => {
    for (const x of ["x;y\n1,5;2\n3;4,5\n", "x\ty\n1\t2\n3\t4\n"]) {
      const once = formatCsv(parseCsv(x).table);
      expect(formatCsv(parseCsv(once).table)).toBe(once);
      expect(parseCsv(once).table).toEqual(parseCsv(x).table);
    }
  });
});

describe("formatCsv", () => {
  it("3.1a writes a comma file with a header row and \\n line endings", () => {
    const text = formatCsv({ cols: [{ name: "x", values: [1, 2] }, { name: "y", values: [0.5, null] }] });
    expect(text).not.toContain("\r");
    expect(text.split("\n").slice(0, 3)).toEqual(["x,y", "1,0.5", "2,"]);
  });

  it("3.1a quotes fields holding a comma, a quote or a newline", () => {
    const table: ChartTable = { cols: [{ name: "n", values: [1, 2, 3] }, { name: "note", values: ["a,b", 'say "hi"', "l1\nl2"] }] };
    const text = formatCsv(table);
    expect(text).toContain('"a,b"');
    expect(text).toContain('"say ""hi"""');
    expect(text).toContain('"l1\nl2"');
    expect(parseCsv(text).table).toEqual(table);
  });
});

describe("parseCsv header detection", () => {
  it("3.1b takes a first row of text over numeric columns as the names", () => {
    const r = parseCsv("time,value\n0,1.5\n1,2.5\n2,3.5\n");
    expect(r.header).toBe(true);
    expect(names(r.table)).toEqual(["time", "value"]);
    expect(values(r.table)).toEqual([[0, 1, 2], [1.5, 2.5, 3.5]]);
  });

  it("3.1b finds no header when the first row is numeric and keeps that row as data", () => {
    const r = parseCsv("1,2\n3,4\n5,6\n");
    expect(r.header).toBe(false);
    expect(values(r.table)).toEqual([[1, 3, 5], [2, 4, 6]]);
  });

  it("3.1b detects a header in a semicolon file with comma decimals", () => {
    const r = parseCsv("a;b\n1,5;2,5\n");
    expect(r.header).toBe(true);
    expect(names(r.table)).toEqual(["a", "b"]);
  });
});
