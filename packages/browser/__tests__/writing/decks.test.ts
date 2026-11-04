// New Presentation and New Poster of the browser project menu: the kind comes from the menu, the format, title and size from the dialogs, and the deck folder is written under talks/ or posters/.
import type { ProjectEntry } from "@labshelf/core";
import { askInputBox, pickQuickEntry } from "@labshelf/core/dom";
import { createDeck } from "../../src/writing/decks";

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), askInputBox: jest.fn(), pickQuickEntry: jest.fn() }));

const project = { kind: "ready", folder: "/projects/p", location: "library", main: "main.tex", settings: { id: "p", format: "latex" } } as Extract<ProjectEntry, { kind: "ready" }>;
const pick = pickQuickEntry as jest.Mock;

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
const ask = askInputBox as jest.Mock;

beforeEach(() => {
  pick.mockReset();
  ask.mockReset();
});

describe("createDeck", () => {
  it("writes a visual presentation into talks/<name>/ without asking the kind", async () => {
    const fs = writableFs();
    pick.mockImplementation(async (entries: Array<{ value: unknown }>) => entries[0]!.value);
    ask.mockResolvedValue("My Defense");
    expect(await createDeck(fs, project, "talk")).toBe("talks/my-defense/deck.html");
    expect(await fs.readText("/projects/p/talks/my-defense/deck.html")).toContain('data-deck="talk"');
    expect(await fs.exists("/projects/p/talks/my-defense/theme.css")).toBe(true);
    expect(pick.mock.calls[0]![1].title).toBe("New presentation: how do you want to make it?");
  });

  it("writes a LaTeX poster into posters/<name>/main.tex", async () => {
    const fs = writableFs();
    pick.mockImplementationOnce(async () => "latex").mockImplementationOnce(async (entries: Array<{ value: unknown }>) => entries[0]!.value);
    ask.mockResolvedValue("Big Poster");
    expect(await createDeck(fs, project, "poster")).toBe("posters/big-poster/main.tex");
    expect(await fs.readText("/projects/p/posters/big-poster/main.tex")).toContain("labshelf: poster");
  });

  it("writes nothing when the user cancels the title", async () => {
    const fs = writableFs();
    pick.mockResolvedValue("html");
    ask.mockResolvedValue(undefined);
    expect(await createDeck(fs, project, "talk")).toBeUndefined();
    expect(await fs.exists("/projects/p/talks")).toBe(false);
  });
});
