import type { MutationContext } from "@labshelf/core";

import { planImports } from "../../../src/library/papers/importInputs";

const ctx = { fs: { exists: async () => false } } as unknown as MutationContext;

describe("planImports", () => {
  it("routes identifiers, including a PubMed link, to the network import", async () => {
    const items = await planImports(ctx, [
      "1706.03762v5",
      "10.1038/nature12373,",
      "https://arxiv.org/html/1706.03762",
      "https://pubmed.ncbi.nlm.nih.gov/12345678/",
    ]);

    expect(items.map((item) => item.kind)).toEqual(["network", "network", "network", "network"]);
  });

  it("routes a link without an identifier to the network import too", async () => {
    const items = await planImports(ctx, ["https://example.org/files/paper.pdf"]);

    expect(items).toEqual([{ kind: "network", value: "https://example.org/files/paper.pdf" }]);
  });
});
