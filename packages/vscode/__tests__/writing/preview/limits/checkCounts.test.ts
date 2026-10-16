/** Verifies that the last check's finding count is remembered per project folder and announced when it changes. */
import { CheckCounts } from "../../../../src/writing/preview/limits";

describe("CheckCounts", () => {
  it("returns undefined before a check and the last count after", () => {
    const counts = new CheckCounts();
    expect(counts.get("/p/a")).toBeUndefined();
    counts.record("/p/a", 3);
    counts.record("/p/b", 0);
    counts.record("/p/a", 2);
    expect([counts.get("/p/a"), counts.get("/p/b")]).toEqual([2, 0]);
  });

  it("calls listeners with the folder on every record and stops after dispose", () => {
    const counts = new CheckCounts();
    const seen: string[] = [];
    const subscription = counts.onChange((folder) => seen.push(folder));
    counts.record("/p/a", 1);
    subscription.dispose();
    counts.record("/p/b", 1);
    expect(seen).toEqual(["/p/a"]);
  });
});
