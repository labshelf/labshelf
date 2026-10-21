// Pins the counted wording of the share rights notice.
import { shareRightsNotice } from "../../../src/share/index";

describe("shareRightsNotice", () => {
  it("names one paper in the singular", () => {
    expect(shareRightsNotice({ label: "Solo", count: 1 }).detail).toContain('read the 1 paper of "Solo"');
  });
  it("names several papers in the plural", () => {
    expect(shareRightsNotice({ label: "Group", count: 2 }).detail).toContain('read the 2 papers of "Group"');
  });
});
