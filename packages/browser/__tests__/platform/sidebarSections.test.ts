// The sidebar sections setting reads defensively from storage and never lets the last visible section be turned off.
import { DEFAULT_SIDEBAR_SECTIONS, readSidebarSections, withSidebarSection } from "../../src/platform/sidebarSections";

describe("reading the sidebar sections", () => {
  it("shows both sections by default and for anything unreadable", () => {
    expect(DEFAULT_SIDEBAR_SECTIONS).toEqual({ library: true, projects: true });
    for (const bad of [undefined, null, "x", 3, [], {}, { library: "no", projects: 0 }]) {
      expect(readSidebarSections(bad)).toEqual({ library: true, projects: true });
    }
  });

  it("keeps a valid choice and defaults a missing half", () => {
    expect(readSidebarSections({ library: false, projects: true })).toEqual({ library: false, projects: true });
    expect(readSidebarSections({ projects: false })).toEqual({ library: true, projects: false });
  });

  it("restores both sections when storage hides both", () => {
    expect(readSidebarSections({ library: false, projects: false })).toEqual({ library: true, projects: true });
  });
});

describe("changing a sidebar section", () => {
  it("turns a section off while the other stays on", () => {
    expect(withSidebarSection({ library: true, projects: true }, "projects", false)).toEqual({ library: true, projects: false });
  });

  it("refuses to turn off the last visible section", () => {
    const only = { library: false, projects: true };
    expect(withSidebarSection(only, "projects", false)).toEqual(only);
  });

  it("turns a section back on", () => {
    expect(withSidebarSection({ library: false, projects: true }, "library", true)).toEqual({ library: true, projects: true });
  });
});
