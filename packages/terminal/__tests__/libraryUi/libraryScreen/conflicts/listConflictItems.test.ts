// Checks the choices offered for conflict copies.
import type { ConflictCopy } from "@labshelf/core";

import { listConflictChoices, formatConflictCount, listConflictItems } from "../../../../src/libraryUi/libraryScreen/conflicts/listConflictItems.js";

const copy = (file: string, paperId = "p1"): ConflictCopy => ({
  owner: { kind: "paper", id: paperId }, original: `/lib/papers/${paperId}/${file}`, copy: `/lib/papers/${paperId}/x`, tool: "dropbox",
});

describe("formatConflictCount", () => {
  it("is empty for none and pluralises", () => {
    expect(formatConflictCount(0)).toBe("");
    expect(formatConflictCount(1)).toBe("1 conflict");
    expect(formatConflictCount(3)).toBe("3 conflicts");
  });
});

describe("listConflictItems", () => {
  it("labels with the title, falling back to the paper id, plus file name and tool", () => {
    const items = listConflictItems([copy("metadata.yaml"), copy("paper.pdf", "p2")], (id) => (id === "p1" ? "Attention" : undefined));
    expect(items).toEqual([
      { id: "0", label: "Attention · metadata.yaml", detail: "dropbox" },
      { id: "1", label: "p2 · paper.pdf", detail: "dropbox" },
    ]);
  });
});

describe("listConflictChoices", () => {
  it("offers the content-match question's three choices", () => {
    const content = { ...copy("main.tex"), owner: { kind: "project" as const, id: "draft" }, match: "similar", tool: "unknown" } as ConflictCopy;
    expect(listConflictChoices(content).map((choice) => choice.label)).toEqual(["Merge Automatically", "Merge Myself", "Not a Version"]);
    expect(listConflictChoices(content).map((choice) => choice.id)).toEqual(["mergeAutomatically", "mergeMyself", "notAVersion"]);
  });

  it("offers three choices for ordinary files", () => {
    expect(listConflictChoices(copy("paper.pdf")).map((c) => c.id)).toEqual(["keepMine", "keepOther", "keepBoth"]);
  });

  it("does not offer keep both for metadata.yaml", () => {
    expect(listConflictChoices(copy("metadata.yaml")).map((c) => c.id)).toEqual(["keepMine", "keepOther"]);
  });
});
