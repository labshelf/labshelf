// Pins which tabs a page load opens for a tabs hash, a folder deep link and a bare URL.
import { derivePagePlan } from "../../../src/libraryUi/pagePlan";
import { deriveRestorePlan as restore } from "../../../src/libraryUi/editorArea/workspace";

const both = derivePagePlan({ library: true, projects: true });
const planRestore = (hash: string, kept: string | null) => restore(hash, kept, both);

const stored = "#/tabs/library,templates;active=templates";

describe("restore plan", () => {
  it("opens the tabs a tabs hash lists, with its active one", () => {
    expect(planRestore("#/tabs/library,all-projects;active=all-projects", stored)).toEqual({ tabs: ["library", "all-projects"], active: "all-projects", folderLink: false });
  });

  it("restores the session's tabs around a folder deep link and focuses the Library", () => {
    expect(planRestore("#/papers/Refs", stored)).toEqual({ tabs: ["library", "templates"], active: "library", folderLink: true });
  });

  it("adds the Library to the session's tabs when they lack it, and works without kept tabs", () => {
    expect(planRestore("#/papers", "#/tabs/templates").tabs).toEqual(["library", "templates"]);
    expect(planRestore("#/papers/Refs", null)).toEqual({ tabs: ["library"], active: "library", folderLink: true });
  });

  it("opens the Library for a bare URL or an empty tabs hash", () => {
    const only = { tabs: ["library"], active: "library", folderLink: false };
    expect(planRestore("", stored)).toEqual(only);
    expect(planRestore("#/tabs/", stored)).toEqual(only);
  });
});

describe("restore plan with a hidden section", () => {
  const noProjects = derivePagePlan({ library: true, projects: false });
  const noLibrary = derivePagePlan({ library: false, projects: true });

  it("drops the tabs of a hidden Projects section and falls back to the Library", () => {
    expect(restore("#/tabs/library,templates;active=templates", null, noProjects)).toEqual({ tabs: ["library"], active: "library", folderLink: false });
    expect(restore("#/tabs/all-projects", null, noProjects)).toEqual({ tabs: ["library"], active: "library", folderLink: false });
    expect(restore("#/papers/Refs", "#/tabs/library,source:p1:main.typ", noProjects)).toEqual({ tabs: ["library"], active: "library", folderLink: true });
  });

  it("opens All projects for a bare URL and drops Library tabs when the Library is hidden", () => {
    expect(restore("", null, noLibrary)).toEqual({ tabs: ["all-projects"], active: "all-projects", folderLink: false });
    expect(restore("#/tabs/library,templates;active=library", null, noLibrary)).toEqual({ tabs: ["templates"], active: "templates", folderLink: false });
  });

  it("ignores a folder deep link when the Library is hidden", () => {
    expect(restore("#/papers/Refs", "#/tabs/templates", noLibrary)).toEqual({ tabs: ["all-projects"], active: "all-projects", folderLink: false });
  });
});
