// Pins the counted wording of the share rights notice.
import { describeShareRightsNotice } from "../../../src/share/index";

describe("describeShareRightsNotice", () => {
  it("names one paper in the singular", () => {
    expect(describeShareRightsNotice({ label: "Solo", count: 1 }).detail).toContain('read the 1 paper of "Solo"');
  });
  it("names several papers in the plural", () => {
    expect(describeShareRightsNotice({ label: "Group", count: 2 }).detail).toContain('read the 2 papers of "Group"');
  });
});
