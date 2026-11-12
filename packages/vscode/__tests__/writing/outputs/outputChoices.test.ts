// Tests what the native editor offers for linked outputs: the actions per state, the linkable files and kinds, the decimals and the run sentence.
import { deriveOutputActions, deriveOutputKindChoices, describeOutputRun, describeOutputUpdate, filterLinkableOutputs, parseDecimalsInput } from "../../../src/writing/outputs/outputChoices";

describe("outputChoices", () => {
  it("offers Link to code when the source is not linked here, and Update only for a stale copy", () => {
    expect(deriveOutputActions({ state: "unlinked" })).toEqual(["link"]);
    expect(deriveOutputActions({ state: "fresh" })).toEqual(["run", "settings"]);
    expect(deriveOutputActions({ state: "stale" })).toEqual(["run", "update", "settings"]);
    expect(deriveOutputActions({ state: "missing" })).toEqual(["run", "settings"]);
  });

  it("lists only the files that can be linked, sorted", () => {
    expect(filterLinkableOutputs(["run.py", "results/b.csv", "fig.png", "results/a.json", "notes.md", "fig.pdf"]))
      .toEqual(["fig.pdf", "fig.png", "results/a.json", "results/b.csv"]);
    expect(filterLinkableOutputs(["run.py", "notes.md"])).toEqual([]);
  });

  it("links CSV and TSV as tables, JSON as values or a table, and the rest as files", () => {
    expect(deriveOutputKindChoices("t.csv")).toEqual(["table"]);
    expect(deriveOutputKindChoices("dir/t.tsv")).toEqual(["table"]);
    expect(deriveOutputKindChoices("m.json")).toEqual(["values", "table"]);
    expect(deriveOutputKindChoices("fig.pdf")).toEqual(["file"]);
    expect(deriveOutputKindChoices("table.tex")).toEqual(["file"]);
  });

  it("accepts empty or a whole number from 0 to 10 as decimals", () => {
    expect(parseDecimalsInput("")).toEqual({ decimals: undefined });
    expect(parseDecimalsInput(" 3 ")).toEqual({ decimals: 3 });
    expect(parseDecimalsInput("0")).toEqual({ decimals: 0 });
    for (const bad of ["-1", "2.5", "11", "x"]) { expect(parseDecimalsInput(bad)).toHaveProperty("error"); }
  });

  it("says how many outputs a finished run updated and nothing for a cancelled or declined one", () => {
    const finished = { status: "finished" as const, code: 0, output: "" };
    expect(describeOutputRun(["a", "b"], finished)).toBe("2 outputs updated.");
    expect(describeOutputRun(["a"], finished)).toBe("1 output updated.");
    expect(describeOutputRun([], finished)).toBe("Ran. No outputs changed.");
    expect(describeOutputRun([], { status: "cancelled" })).toBeUndefined();
    expect(describeOutputRun([], { status: "declined" })).toBeUndefined();
  });

  it("names who updated a link when it is known and keeps an unreadable time as written", () => {
    expect(describeOutputUpdate({ updated: "soon", by: "Ana" })).toBe("Updated soon by Ana");
    expect(describeOutputUpdate({ updated: "2026-11-11T10:00:00.000Z" })).toMatch(/^Updated \S/);
  });
});
