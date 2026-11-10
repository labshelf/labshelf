// Tests selectMirrorFiles (spec 3.2, D2, D16): what the Mirror holds, as library-relative paths with a kind and a read() each.
// Written as if the file sat at packages/core/__tests__/remoteLibrary/mirrorSelection.test.ts; relative imports are resolved from there.
import { selectMirrorFiles, type MirrorFile, type MirrorPaper, type MirrorSelectionDeps } from "../../src/remoteLibrary/mirrorSelection.js";

const MIB = 1024 * 1024;
const DECK_HTML = "<!doctype html><html data-deck=\"talk\"><body>exported</body></html>";

const PAPERS: MirrorPaper[] = [
  { id: "p1", folder: "ml/vision", trashed: false, record: { id: "p1", title: "Seeing" } },
  { id: "p2", folder: "stats", trashed: false, record: { id: "p2", title: "Counting" } },
  { id: "gone", folder: "ml", trashed: true, record: { id: "gone", title: "Deleted" } },
];

const FILES = [
  "papers/ml/vision/p1/notes.qmd",
  "papers/ml/vision/p1/paper.pdf",
  "papers/ml/vision/p1/metadata.yaml",
  "papers/stats/p2/notes.qmd",
  "papers/ml/gone/notes.qmd",
  "papers/ml/gone/paper.pdf",
  "projects/thesis/main.tex",
  "projects/thesis/refs.bib",
  "projects/thesis/chapters/intro.qmd",
  "projects/thesis/poster.typ",
  "projects/thesis/figure.pdf",
  "projects/thesis/main.labshelf-conflict-2.tex",
  "projects/thesis/.git/config.tex",
  "projects/thesis/.cache/notes.qmd",
  "projects/thesis/build/main.tex",
  "projects/thesis/_output/index.qmd",
  "projects/thesis/talk/deck.html",
  "projects/thesis/talk/theme.css",
  "projects/thesis/.hidden/deck.html",
];

interface Harness { deps: MirrorSelectionDeps; exported: string[]; texts: Map<string, string> }

function harness(options: { papers?: MirrorPaper[]; files?: string[]; exportDeck?: (path: string) => Promise<{ html: string }> } = {}): Harness {
  const exported: string[] = [];
  const texts = new Map<string, string>();
  const deps: MirrorSelectionDeps = {
    papers: options.papers ?? PAPERS,
    listFiles: async () => options.files ?? FILES,
    readText: async (path) => {
      const text = texts.get(path) ?? `text of ${path}`;
      return text;
    },
    exportDeck: async (path) => {
      exported.push(path);
      return options.exportDeck ? options.exportDeck(path) : { html: DECK_HTML };
    },
  };
  return { deps, exported, texts };
}

const byPath = (files: MirrorFile[]): Map<string, MirrorFile> => new Map(files.map((file) => [file.path, file]));

describe("selectMirrorFiles", () => {
  it("3.2b lists exactly the papers index, notes, project sources and decks", async () => {
    const { files } = await selectMirrorFiles(harness().deps);
    expect(files.map((file) => file.path).sort()).toEqual([
      "index/papers.json",
      "papers/ml/vision/p1/notes.qmd",
      "papers/stats/p2/notes.qmd",
      "projects/thesis/chapters/intro.qmd",
      "projects/thesis/main.tex",
      "projects/thesis/poster.typ",
      "projects/thesis/refs.bib",
      "projects/thesis/talk/deck.html",
    ]);
  });

  it("3.2b gives each file its kind", async () => {
    const { files } = await selectMirrorFiles(harness().deps);
    const kinds = Object.fromEntries(files.map((file) => [file.path, file.kind]));
    expect(kinds).toEqual({
      "index/papers.json": "papers",
      "papers/ml/vision/p1/notes.qmd": "notes",
      "papers/stats/p2/notes.qmd": "notes",
      "projects/thesis/chapters/intro.qmd": "source",
      "projects/thesis/main.tex": "source",
      "projects/thesis/poster.typ": "source",
      "projects/thesis/refs.bib": "source",
      "projects/thesis/talk/deck.html": "deck",
    });
  });

  it("3.2b answers the papers index in the D16 shape without trashed papers", async () => {
    const { files } = await selectMirrorFiles(harness().deps);
    const index = JSON.parse(await byPath(files).get("index/papers.json")!.read()) as { version: number; folders: string[]; papers: { id: string; folder: string; record: unknown }[] };
    expect(index.version).toBe(1);
    expect(index.papers).toHaveLength(2);
    expect(index.papers.find((paper) => paper.id === "p1")).toEqual({ id: "p1", folder: "ml/vision", record: { id: "p1", title: "Seeing" } });
    expect(index.papers.find((paper) => paper.id === "p2")).toEqual({ id: "p2", folder: "stats", record: { id: "p2", title: "Counting" } });
    expect(index.papers.some((paper) => paper.id === "gone")).toBe(false);
  });

  it("3.2b lists the folders of kept papers with their parents, sorted", async () => {
    const { files } = await selectMirrorFiles(harness().deps);
    const index = JSON.parse(await byPath(files).get("index/papers.json")!.read()) as { folders: string[] };
    expect(index.folders).toEqual(["ml", "ml/vision", "stats"]);
  });

  it("3.2b leaves the folders of trashed papers and the library root out of the folder tree", async () => {
    const papers: MirrorPaper[] = [
      { id: "r1", folder: "", trashed: false, record: { id: "r1" } },
      { id: "t1", folder: "archive/old", trashed: true, record: { id: "t1" } },
    ];
    const { files } = await selectMirrorFiles(harness({ papers, files: ["papers/r1/notes.qmd", "papers/archive/old/t1/notes.qmd"] }).deps);
    const index = JSON.parse(await byPath(files).get("index/papers.json")!.read()) as { folders: string[]; papers: { id: string }[] };
    expect(index.folders).toEqual([]);
    expect(index.papers.map((paper) => paper.id)).toEqual(["r1"]);
    expect(files.map((file) => file.path).sort()).toEqual(["index/papers.json", "papers/r1/notes.qmd"]);
  });

  it("3.2b reads notes and sources through deps.readText", async () => {
    const { deps, texts } = harness();
    texts.set("papers/stats/p2/notes.qmd", "# Notes on counting");
    texts.set("projects/thesis/refs.bib", "@book{a, title={A}}");
    const files = byPath((await selectMirrorFiles(deps)).files);
    expect(await files.get("papers/stats/p2/notes.qmd")!.read()).toBe("# Notes on counting");
    expect(await files.get("projects/thesis/refs.bib")!.read()).toBe("@book{a, title={A}}");
  });

  it("3.2b reads a deck as the html of deps.exportDeck for its path", async () => {
    const { deps, exported } = harness();
    const files = byPath((await selectMirrorFiles(deps)).files);
    expect(await files.get("projects/thesis/talk/deck.html")!.read()).toBe(DECK_HTML);
    expect(exported).toContain("projects/thesis/talk/deck.html");
  });

  it("3.2b skips the notes of a trashed paper", async () => {
    const { files } = await selectMirrorFiles(harness().deps);
    expect(files.map((file) => file.path)).not.toContain("papers/ml/gone/notes.qmd");
  });

  it("3.2b skips conflict copies", async () => {
    const { files } = await selectMirrorFiles(harness().deps);
    expect(files.some((file) => file.path.includes(".labshelf-conflict-"))).toBe(false);
  });

  it("3.2b skips hidden folders, even a hidden deck", async () => {
    const { files } = await selectMirrorFiles(harness().deps);
    expect(files.some((file) => file.path.split("/").some((segment) => segment.startsWith(".")))).toBe(false);
  });

  it("3.2b skips build and _output folders", async () => {
    const { files } = await selectMirrorFiles(harness().deps);
    const paths = files.map((file) => file.path);
    expect(paths).not.toContain("projects/thesis/build/main.tex");
    expect(paths).not.toContain("projects/thesis/_output/index.qmd");
  });

  it("3.2b skips every pdf", async () => {
    const { files } = await selectMirrorFiles(harness().deps);
    expect(files.some((file) => file.path.endsWith(".pdf"))).toBe(false);
  });

  it("3.2b keeps a deck nested below the project root under its own path", async () => {
    const { files } = await selectMirrorFiles(harness({ files: ["projects/lab/talks/spring/deck.html"] }).deps);
    expect(byPath(files).get("projects/lab/talks/spring/deck.html")?.kind).toBe("deck");
  });

  it("3.2c skips a deck whose export throws, with a reason, and returns the other files", async () => {
    const exportDeck = async (path: string): Promise<{ html: string }> => {
      if (path === "projects/thesis/talk/deck.html") throw new Error("The deck has errors: DECK001.");
      return { html: DECK_HTML };
    };
    const files2 = ["projects/thesis/main.tex", "projects/thesis/talk/deck.html", "projects/thesis/other/deck.html"];
    const selection = await selectMirrorFiles(harness({ files: files2, exportDeck }).deps);
    const skipped = selection.skipped.find((entry) => entry.path === "projects/thesis/talk/deck.html");
    expect(skipped).toBeDefined();
    expect(skipped!.reason.length).toBeGreaterThan(0);
    const paths = selection.files.map((file) => file.path);
    expect(paths).not.toContain("projects/thesis/talk/deck.html");
    expect(paths).toContain("projects/thesis/main.tex");
    expect(paths).toContain("projects/thesis/other/deck.html");
    expect(paths).toContain("index/papers.json");
  });

  it("3.2c skips a deck over 20 MiB, with a reason, and returns the other files", async () => {
    const exportDeck = async (path: string): Promise<{ html: string }> =>
      path === "projects/thesis/talk/deck.html" ? { html: "a".repeat(20 * MIB + 1) } : { html: DECK_HTML };
    const files2 = ["projects/thesis/main.tex", "projects/thesis/talk/deck.html", "projects/thesis/other/deck.html"];
    const selection = await selectMirrorFiles(harness({ files: files2, exportDeck }).deps);
    const skipped = selection.skipped.find((entry) => entry.path === "projects/thesis/talk/deck.html");
    expect(skipped).toBeDefined();
    expect(skipped!.reason.length).toBeGreaterThan(0);
    const paths = selection.files.map((file) => file.path);
    expect(paths).not.toContain("projects/thesis/talk/deck.html");
    expect(paths).toContain("projects/thesis/main.tex");
    expect(paths).toContain("projects/thesis/other/deck.html");
  });

  it("3.2c measures the 20 MiB limit in UTF-8 bytes", async () => {
    // 10 MiB + 1 two-byte characters: under 20 MiB as a string length, over it as bytes.
    const html = "é".repeat(10 * MIB + 1);
    const selection = await selectMirrorFiles(harness({ files: ["projects/thesis/talk/deck.html"], exportDeck: async () => ({ html }) }).deps);
    expect(selection.files.map((file) => file.path)).not.toContain("projects/thesis/talk/deck.html");
    expect(selection.skipped.map((entry) => entry.path)).toContain("projects/thesis/talk/deck.html");
  });

  it("3.2c keeps a deck of exactly 20 MiB", async () => {
    const html = "a".repeat(20 * MIB);
    const selection = await selectMirrorFiles(harness({ files: ["projects/thesis/talk/deck.html"], exportDeck: async () => ({ html }) }).deps);
    expect(selection.files.map((file) => file.path)).toContain("projects/thesis/talk/deck.html");
    expect(selection.skipped.map((entry) => entry.path)).not.toContain("projects/thesis/talk/deck.html");
  });

  it("3.2c lists no skipped deck when every deck exports", async () => {
    const selection = await selectMirrorFiles(harness().deps);
    expect(selection.skipped.map((entry) => entry.path)).not.toContain("projects/thesis/talk/deck.html");
  });
});
