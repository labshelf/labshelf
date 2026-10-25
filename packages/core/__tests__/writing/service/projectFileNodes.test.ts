// Tests the Files tree rows: hidden entries, folders-first order and the main and source marks.
import { createProjectFileRow, listVisibleEntries } from "../../../src/writing/index";

describe("listVisibleEntries", () => {
  it("drops .git and .labshelf and lists folders first, then by name", () => {
    const entries = [
      { name: "refs.bib", folder: false }, { name: ".labshelf", folder: true }, { name: "src", folder: true },
      { name: "Abstract.tex", folder: false }, { name: ".git", folder: true }, { name: "figures", folder: true },
    ];
    expect(listVisibleEntries(entries).map((entry) => entry.name)).toEqual(["figures", "src", "Abstract.tex", "refs.bib"]);
  });
});

describe("createProjectFileRow", () => {
  const context = { format: "latex", main: "./src/main.tex" } as const;

  it("marks the main file and opens files on click", () => {
    const { kind, node } = createProjectFileRow("src/main.tex", false, context);
    expect(kind).toBe("file");
    expect(node).toMatchObject({ key: "src/main.tex", label: "main.tex", description: "main", clickable: true });
  });

  it("offers other sources of the project's format as the main file", () => {
    expect(createProjectFileRow("src/intro.tex", false, context).kind).toBe("source");
    expect(createProjectFileRow("refs.bib", false, context).kind).toBe("file");
    expect(createProjectFileRow("a.typ", false, { format: "typst", main: undefined }).kind).toBe("source");
    expect(createProjectFileRow("a.tex", false, { format: undefined, main: undefined }).kind).toBe("file");
  });

  it("shows a folder as a collapsed node with no description", () => {
    const { kind, node } = createProjectFileRow("src", true, context);
    expect(kind).toBe("folder");
    expect(node).toMatchObject({ label: "src", children: [], open: false });
    expect(node.description).toBeUndefined();
  });
});
