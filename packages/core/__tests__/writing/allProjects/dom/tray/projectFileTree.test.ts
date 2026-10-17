// Tests that a project's file paths become the tray's visible rows: folders first, open folders unfolded one level deeper.
import { projectFileTree } from "../../../../../src/writing/allProjects/dom/tray/projectFileTree";

const paths = ["main.tex", "sec/b.tex", "sec/a.tex", "fig/plot10.pdf", "fig/plot2.pdf", "refs.bib", "sec/deep/x.tex"];

const shown = (open: string[]) =>
  projectFileTree(paths, new Set(open)).map((e) => `${"  ".repeat(e.depth)}${e.folder ? `${e.name}/${e.open ? "-" : "+"}` : e.name}`);

describe("projectFileTree", () => {
  it("lists top-level folders first, then files, each sorted by name", () => {
    expect(shown([])).toEqual(["fig/+", "sec/+", "main.tex", "refs.bib"]);
  });

  it("shows an open folder's children one level deeper, sorting numbers by value", () => {
    expect(shown(["fig", "sec", "sec/deep"])).toEqual([
      "fig/-", "  plot2.pdf", "  plot10.pdf", "sec/-", "  deep/-", "    x.tex", "  a.tex", "  b.tex", "main.tex", "refs.bib",
    ]);
  });

  it("keeps a nested open folder hidden while its parent is closed, and gives each entry its full path", () => {
    expect(shown(["sec/deep"])).toEqual(["fig/+", "sec/+", "main.tex", "refs.bib"]);
    expect(projectFileTree(["sec/deep/x.tex"], new Set(["sec", "sec/deep"])).map((e) => e.path)).toEqual(["sec", "sec/deep", "sec/deep/x.tex"]);
  });
});
