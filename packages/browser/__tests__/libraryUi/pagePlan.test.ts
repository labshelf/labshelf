// The page plan turns the sidebar sections setting into the sections to mount, the tab kinds to allow and the default tab.
import { isKindShown, derivePagePlan } from "../../src/libraryUi/pagePlan";

describe("page plan", () => {
  it("shows both sections and opens the Library by default", () => {
    expect(derivePagePlan({ library: true, projects: true })).toEqual({ library: true, projects: true, defaultTab: "library" });
  });

  it("opens the Library by default when Projects is hidden", () => {
    expect(derivePagePlan({ library: true, projects: false })).toEqual({ library: true, projects: false, defaultTab: "library" });
  });

  it("opens All projects by default when the Library is hidden", () => {
    expect(derivePagePlan({ library: false, projects: true })).toEqual({ library: false, projects: true, defaultTab: "all-projects" });
  });

  it("allows a tab kind only while its section is shown", () => {
    const noProjects = derivePagePlan({ library: true, projects: false });
    for (const kind of ["library", "spaces", "space"]) expect(isKindShown(noProjects, kind)).toBe(true);
    for (const kind of ["all-projects", "templates", "source", "preview"] as const) expect(isKindShown(noProjects, kind)).toBe(false);
    const noLibrary = derivePagePlan({ library: false, projects: true });
    for (const kind of ["library", "spaces", "space"]) expect(isKindShown(noLibrary, kind)).toBe(false);
    expect(isKindShown(noLibrary, "templates")).toBe(true);
  });
});
