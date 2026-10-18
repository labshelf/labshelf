// The page plan turns the sidebar sections setting into the sections to mount, the tab kinds to allow and the default tab.
import { isKindShown, planPage } from "../../../src/library-page/sections/pagePlan";

describe("page plan", () => {
  it("shows both sections and opens the Library by default", () => {
    expect(planPage({ library: true, projects: true })).toEqual({ library: true, projects: true, defaultTab: "library" });
  });

  it("opens the Library by default when Projects is hidden", () => {
    expect(planPage({ library: true, projects: false })).toEqual({ library: true, projects: false, defaultTab: "library" });
  });

  it("opens All projects by default when the Library is hidden", () => {
    expect(planPage({ library: false, projects: true })).toEqual({ library: false, projects: true, defaultTab: "all-projects" });
  });

  it("allows a tab kind only while its section is shown", () => {
    const noProjects = planPage({ library: true, projects: false });
    expect(isKindShown(noProjects, "library")).toBe(true);
    for (const kind of ["all-projects", "templates", "source", "preview"] as const) expect(isKindShown(noProjects, kind)).toBe(false);
    const noLibrary = planPage({ library: false, projects: true });
    expect(isKindShown(noLibrary, "library")).toBe(false);
    expect(isKindShown(noLibrary, "templates")).toBe(true);
  });
});
