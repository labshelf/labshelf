/** Verifies the words install uses for each paper and for the closing message. */
import type { ImportOutcome } from "../../../src/library";
import type { PaperRecord } from "../../../src/model";
import { describeInstall, describeInstallReport, type InstallResult } from "../../../src/writing/project/index";

const record = (citeKey: string, hasPdf: boolean): PaperRecord => ({ id: citeKey, title: "T", path: citeKey, citeKey, status: "unread", hasPdf }) as PaperRecord;
const added = (citeKey: string, hasPdf = true): ImportOutcome => ({ status: "added", record: record(citeKey, hasPdf), needsReview: false, input: "10.1/x" });
const toImport = (key: string, outcome: ImportOutcome): InstallResult => ({ entry: { kind: "import", key, doi: "10.1/x" }, outcome });

describe("describeInstall", () => {
  it("words every kind of entry and every import outcome", () => {
    const lines = (results: InstallResult[]) => results.map((r) => describeInstall(r).text);
    expect(lines([
      { entry: { kind: "present", key: "a" } },
      { entry: { kind: "other-key", key: "b", existingKey: "b2020" } },
      { entry: { kind: "no-doi", key: "c" } },
      toImport("d", added("d")),
      toImport("e", added("e", false)),
      toImport("f", added("f2")),
      toImport("g", { status: "failed", error: "Could not find DOI 10.1/x", input: "10.1/x" }),
      toImport("h", { status: "duplicate", existingId: "h9", input: "10.1/x" }),
    ])).toEqual([
      "a: already in the library",
      "b: in the library as b2020; cite it by that key or rename the paper",
      "c: no DOI listed, cannot install",
      "d: added",
      "e: added without a PDF",
      "f: added as f2 because f was taken",
      "g: failed: Could not find DOI 10.1/x",
      "h: in the library as h9; cite it by that key or rename the paper",
    ]);
  });
});

describe("describeInstallReport", () => {
  it("counts what was added, was there already and still does not resolve", () => {
    const summary = describeInstallReport([
      { entry: { kind: "present", key: "a" } },
      toImport("d", added("d")),
      toImport("e", added("e", false)),
      { entry: { kind: "no-doi", key: "c" } },
    ]);
    expect(summary).toEqual({ level: "warn", text: "2 added, 1 already in the library, 1 without a PDF, 1 not resolved" });
  });

  it("is quiet when every key resolves with its PDF", () => {
    expect(describeInstallReport([toImport("d", added("d"))])).toEqual({ level: "info", text: "1 added, 0 already in the library" });
  });

  it("says so when the project lists nothing", () => {
    expect(describeInstallReport([])).toEqual({ level: "info", text: "The project lists no papers" });
  });
});
