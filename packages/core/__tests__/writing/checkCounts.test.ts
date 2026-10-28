/** Verifies the remembered finding count of each project's last check and its change listeners. */
import { CheckCounts } from "../../src/writing/index";

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
