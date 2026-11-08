// New Presentation and New Poster of the browser project menu: the kind comes from the menu, the format, template, title and size from the picker,
// and the deck folder is written under talks/ or posters/.
import type { DeckTemplateChoice, ProjectEntry } from "@labshelf/core";
import { createDeck } from "../../src/writing/session";

const project = { kind: "ready", folder: "/projects/p", location: "library", main: "main.tex", settings: { id: "p", format: "latex" } } as Extract<ProjectEntry, { kind: "ready" }>;

/** The files createDeck writes, in memory. */
function writableFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    exists: async (path: string) => files.has(path) || dirs.has(path),
    ensureDir: async (path: string) => { dirs.add(path); },
    writeText: async (path: string, text: string) => { files.set(path, text); },
    readText: async (path: string) => files.get(path) ?? "",
  };
}

const choice = (over: Partial<DeckTemplateChoice>): DeckTemplateChoice => ({
  kind: "talk", format: "html", template: "generic", title: "My Defense", size: { w: 1920, h: 1080, unit: "px" }, style: null, ...over,
});

describe("createDeck", () => {
  it("writes a visual presentation into talks/<name>/ and asks the picker for the kind", async () => {
    const fs = writableFs();
    const pick = jest.fn(async () => choice({}));
    expect(await createDeck(fs, project, "talk", { pick })).toBe("talks/my-defense/deck.html");
    expect(await fs.readText("/projects/p/talks/my-defense/deck.html")).toContain('data-deck="talk"');
    expect(await fs.exists("/projects/p/talks/my-defense/theme.css")).toBe(true);
    expect(pick).toHaveBeenCalledWith({ kind: "talk", formats: ["html", "latex"], kits: [] });
  });

  it("writes a LaTeX poster into posters/<name>/main.tex", async () => {
    const fs = writableFs();
    const picked = choice({ kind: "poster", format: "latex", title: "Big Poster", size: { w: 841, h: 1189, unit: "mm" } });
    expect(await createDeck(fs, project, "poster", { pick: async () => picked })).toBe("posters/big-poster/main.tex");
    expect(await fs.readText("/projects/p/posters/big-poster/main.tex")).toContain("labshelf: poster");
  });

  it("writes nothing when the user cancels the picker", async () => {
    const fs = writableFs();
    expect(await createDeck(fs, project, "talk", { pick: async () => null })).toBeUndefined();
    expect(await fs.exists("/projects/p/talks")).toBe(false);
  });
});
