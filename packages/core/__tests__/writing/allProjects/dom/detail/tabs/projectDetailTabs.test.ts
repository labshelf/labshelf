// Tests the tab list of the All projects detail pane and its count badges.
import { projectDetailTabs } from "../../../../../../src/writing/allProjects/dom/detail/tabs/projectDetailTabs";
import { detail } from "../fixtures";

describe("projectDetailTabs", () => {
  it("badges Citations and Versions with their counts", () => {
    expect(projectDetailTabs(detail)).toEqual([
      { id: "overview", label: "Overview" },
      { id: "citations", label: "Citations", badge: "3" },
      { id: "versions", label: "Versions", badge: "1" },
    ]);
  });

  it("leaves the badges off before the detail arrives or when a list is empty", () => {
    expect(projectDetailTabs(undefined).every((t) => t.badge === undefined)).toBe(true);
    expect(projectDetailTabs({ ...detail, versions: [] })[2]).toEqual({ id: "versions", label: "Versions" });
  });
});
