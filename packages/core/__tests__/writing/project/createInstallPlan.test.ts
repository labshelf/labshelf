/** Verifies that the install plan tells apart papers the library has, holds under another key, cannot fetch and must import. */
import type { PaperRecord } from "../../../src/model";
import { createInstallPlan } from "../../../src/writing/project/index";

const paper = (id: string, citeKey: string, doi?: string): PaperRecord =>
  ({ id, title: id, path: id, citeKey, status: "unread", ...(doi ? { doi } : {}) }) as PaperRecord;

const library = [paper("a-folder", "alpha2020", "10.1/Alpha"), paper("beta", "beta2021", "10.1/beta")];

describe("createInstallPlan", () => {
  it("classifies each listed paper, keeping the listed order", () => {
    const plan = createInstallPlan(
      [{ key: "beta2021", doi: "10.9/x" }, { key: "alpha", doi: "10.1/alpha" }, { key: "nodoi" }, { key: "gamma", doi: "10.1/gamma" }],
      library,
    );
    expect(plan).toEqual([
      { kind: "present", key: "beta2021" },
      { kind: "other-key", key: "alpha", existingKey: "alpha2020" },
      { kind: "no-doi", key: "nodoi" },
      { kind: "import", key: "gamma", doi: "10.1/gamma" },
    ]);
  });

  it("finds a paper by cite key even when its DOI differs or is missing from the list", () => {
    expect(createInstallPlan([{ key: "alpha2020" }], library)).toEqual([{ kind: "present", key: "alpha2020" }]);
  });

  it("refuses a key that could name a path outside the library", () => {
    expect(createInstallPlan([{ key: "../evil", doi: "10.1/z" }, { key: "a/b", doi: "10.1/y" }, { key: ".hidden", doi: "10.1/w" }], []))
      .toEqual([{ kind: "bad-key", key: "../evil" }, { kind: "bad-key", key: "a/b" }, { kind: "bad-key", key: ".hidden" }]);
  });

  it("plans a key listed twice once", () => {
    expect(createInstallPlan([{ key: "g", doi: "10.1/g" }, { key: "g", doi: "10.1/g" }], [])).toEqual([{ kind: "import", key: "g", doi: "10.1/g" }]);
  });
});
