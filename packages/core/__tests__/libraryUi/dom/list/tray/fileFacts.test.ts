// Tests the fact of the paper.pdf tray row: the user's short note, or a placeholder hint when there is none.
import type { PaperRecord } from "../../../../../src/model";
import type { PaperFile } from "../../../../../src/libraryUi";
import { deriveTrayEntries } from "../../../../../src/libraryUi/dom/list/tray/fileFacts";

const record = { id: "p", title: "T", summary: "An abstract. More." } as PaperRecord;
const pdf = (description?: string): PaperFile => ({ name: "paper.pdf", kind: "file", size: 1, modified: "2026-01-01T00:00:00.000Z", ...(description ? { description } : {}) });
const pdfEntry = (file: PaperFile) => deriveTrayEntries(record, [file]).find((e) => e.kind === "pdf")!;

describe("paper.pdf fact", () => {
  it("is the description without a label", () => {
    expect(pdfEntry(pdf("the one about X")).fact).toEqual({ label: "", text: "the one about X" });
  });

  it("is a flagged placeholder when there is no description, whatever the abstract says", () => {
    expect(pdfEntry(pdf()).fact).toEqual({ label: "", text: "Add a short note", placeholder: true });
  });
});
