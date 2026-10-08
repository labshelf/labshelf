import { crumbs } from "../../src/ui/format";

describe("crumbs", () => {
  it("starts with papers and adds each folder", () => {
    expect(crumbs("")).toEqual(["papers"]);
    expect(crumbs("ML")).toEqual(["papers", "ML"]);
    expect(crumbs("ML/Transformers")).toEqual(["papers", "ML", "Transformers"]);
  });

  it("ignores stray slashes", () => {
    expect(crumbs("/ML//Transformers/")).toEqual(["papers", "ML", "Transformers"]);
  });
});
