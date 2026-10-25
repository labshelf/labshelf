// Tests the tab list of the All projects detail pane and its count badges.
import { deriveProjectPaneTabs } from "../../../../../../src/writing/allProjects/dom/detailPane/tabs/projectDetailPaneTabs";
import { detail } from "../fixtures";

describe("deriveProjectPaneTabs", () => {
  it("badges Citations and Versions with their counts", () => {
    expect(deriveProjectPaneTabs(detail)).toEqual([
      { id: "overview", label: "Overview" },
      { id: "citations", label: "Citations", badge: "3" },
      { id: "versions", label: "Versions", badge: "1" },
    ]);
  });

  it("leaves the badges off before the detail arrives or when a list is empty", () => {
    expect(deriveProjectPaneTabs(undefined).every((t) => t.badge === undefined)).toBe(true);
    expect(deriveProjectPaneTabs({ ...detail, versions: [] })[2]).toEqual({ id: "versions", label: "Versions" });
  });
});
