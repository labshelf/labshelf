import type { ConflictCopy } from "@labshelf/core";

import { conflictChoices, conflictCountLabel, conflictItems } from "../../../../src/ui/app/conflicts/conflictItems.js";

const copy = (file: string, paperId = "p1"): ConflictCopy => ({
  owner: { kind: "paper", id: paperId }, original: `/lib/papers/${paperId}/${file}`, copy: `/lib/papers/${paperId}/x`, tool: "dropbox",
});

describe("conflictCountLabel", () => {
  it("is empty for none and pluralises", () => {
    expect(conflictCountLabel(0)).toBe("");
    expect(conflictCountLabel(1)).toBe("1 conflict");
    expect(conflictCountLabel(3)).toBe("3 conflicts");
  });
});

describe("conflictItems", () => {
  it("labels with the title, falling back to the paper id, plus file name and tool", () => {
    const items = conflictItems([copy("metadata.yaml"), copy("paper.pdf", "p2")], (id) => (id === "p1" ? "Attention" : undefined));
    expect(items).toEqual([
      { id: "0", label: "Attention · metadata.yaml", detail: "dropbox" },
      { id: "1", label: "p2 · paper.pdf", detail: "dropbox" },
    ]);
  });
});

describe("conflictChoices", () => {
  it("offers three choices for ordinary files", () => {
    expect(conflictChoices(copy("paper.pdf")).map((c) => c.id)).toEqual(["keepMine", "keepOther", "keepBoth"]);
  });

  it("does not offer keep both for metadata.yaml", () => {
    expect(conflictChoices(copy("metadata.yaml")).map((c) => c.id)).toEqual(["keepMine", "keepOther"]);
  });
});
