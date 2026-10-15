import * as os from "node:os";

import type { MutationContext } from "@labshelf/core";

import { sortImportInputs } from "../../../src/library/papers/importInputs";

const ctx = { fs: { exists: async () => false } } as unknown as MutationContext;

describe("sortImportInputs", () => {
  it("routes identifiers and links, including a PubMed link, to the network import", async () => {
    const sorted = await sortImportInputs(ctx, [
      "1706.03762v5",
      "10.1038/nature12373,",
      "https://arxiv.org/html/1706.03762",
      " https://example.org/files/paper.pdf ",
      "   ",
    ]);

    expect(sorted).toEqual({
      local: [],
      network: ["1706.03762v5", "10.1038/nature12373,", "https://arxiv.org/html/1706.03762", "https://example.org/files/paper.pdf"],
    });
  });

  it("resolves an existing path, expanding ~ to the home folder", async () => {
    const existing = { fs: { exists: async () => true } } as unknown as MutationContext;

    expect(await sortImportInputs(existing, ["~/gone/../link", "~"])).toEqual({ local: [`${os.homedir()}/link`, os.homedir()], network: [] });
  });
});
