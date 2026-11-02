// Talks & Posters in the browser sidebar: the rows of a project, their menus, Present and Poster preview, and the slide edits on a source talk.
import type { ProjectEntry, SidebarTreeNode } from "@labshelf/core";
import { listDeckNodes, parseDeckKey, runDeckMenu, type DeckMenuDeps } from "../../src/writing/decks";
import { memoryFs } from "../support/memoryFs";

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), askDialog: jest.fn(async () => true) }));

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const BEAMER = "\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{One}\nA\n\\end{frame}\n\\begin{frame}{Two}\nB\n\\end{frame}\n\\end{document}\n";
const project = { kind: "ready", folder: "/projects/p", location: "library", main: "main.tex", settings: { id: "p", format: "latex" } } as Extract<ProjectEntry, { kind: "ready" }>;
const FILES = {
  "/projects/p/main.tex": "\\documentclass{article}",
  "/projects/p/talks/visual/deck.html": "<html></html>",
  "/projects/p/talks/visual/theme.css": ":root {}",
  "/projects/p/talks/defense/main.tex": BEAMER,
  "/projects/p/posters/a0/main.tex": "\\documentclass{tikzposter}\n\\block{Intro}{x}",
};

const contextOf = (files: Record<string, string>) => ({ fs: memoryFs(files), paths: { join: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/") } as never, logger });

describe("listDeckNodes", () => {
  it("lists talks first with kind and format, source talks folding open on their slides with the slide menu", async () => {
    const nodes = await listDeckNodes(contextOf(FILES) as never, project);
    expect(nodes.map((n) => [n.label, n.description])).toEqual([["defense", "Talk · LaTeX"], ["visual", "Talk · Visual"], ["a0", "Poster · LaTeX"]]);
    expect(nodes[0]!.menu?.map((m) => m.action)).toEqual(["present"]);
    expect(nodes[2]!.menu?.map((m) => m.action)).toEqual(["posterPreview"]);
    const slides = nodes[0]!.children as SidebarTreeNode[];
    expect(slides.map((s) => [s.label, s.key])).toEqual([["One", "item:talks/defense/main.tex:2"], ["Two", "item:talks/defense/main.tex:5"]]);
    expect(slides[0]!.menu?.map((m) => m.action)).toEqual(["moveSlideUp", "moveSlideDown", "duplicateSlide", "deleteSlide"]);
    expect(nodes[2]!.children?.[0]?.menu).toBeUndefined();
  });

  it("reads row keys back", () => {
    expect(parseDeckKey("deck:talks/a/deck.html")).toEqual({ kind: "deck", path: "talks/a/deck.html" });
    expect(parseDeckKey("item:talks/a/main.tex:12")).toEqual({ kind: "item", path: "talks/a/main.tex", line: 12 });
    expect(parseDeckKey("other")).toBeNull();
  });
});

describe("runDeckMenu", () => {
  function deps(files: Record<string, string>): DeckMenuDeps & { written: Map<string, string>; openTab: jest.Mock; openAudience: jest.Mock } {
    const fs = memoryFs(files);
    const written = new Map<string, string>();
    return {
      fs: { readText: (path) => (written.has(path) ? Promise.resolve(written.get(path)!) : fs.readText(path)), writeText: async (path, text) => { written.set(path, text); } },
      written, openTab: jest.fn(), openAudience: jest.fn(async () => undefined),
    };
  }

  it("Present opens the presenter tab and the audience tab", async () => {
    const d = deps(FILES);
    await runDeckMenu(d, project, "deck:talks/defense/main.tex", "present");
    expect(d.openTab).toHaveBeenCalledWith("deck", { projectId: "p", path: "talks/defense/main.tex", view: "presenter" });
    expect(d.openAudience).toHaveBeenCalledWith({ projectId: "p", path: "talks/defense/main.tex" });
  });

  it("Poster preview opens the poster view", async () => {
    const d = deps(FILES);
    await runDeckMenu(d, project, "deck:posters/a0/main.tex", "posterPreview");
    expect(d.openTab).toHaveBeenCalledWith("deck", { projectId: "p", path: "posters/a0/main.tex", view: "poster" });
  });

  it("moves, duplicates and deletes a slide in the source file", async () => {
    const d = deps(FILES);
    const file = "/projects/p/talks/defense/main.tex";
    expect(await runDeckMenu(d, project, "item:talks/defense/main.tex:2", "moveSlideDown")).toBe(true);
    expect(d.written.get(file)!.indexOf("{Two}")).toBeLessThan(d.written.get(file)!.indexOf("{One}"));
    const again = deps(FILES);
    await runDeckMenu(again, project, "item:talks/defense/main.tex:5", "duplicateSlide");
    expect(again.written.get(file)!.match(/\{Two\}/g)).toHaveLength(2);
    const gone = deps(FILES);
    await runDeckMenu(gone, project, "item:talks/defense/main.tex:2", "deleteSlide");
    expect(gone.written.get(file)).not.toContain("{One}");
  });

  it("does nothing for a slide line that no longer starts a slide", async () => {
    const d = deps(FILES);
    expect(await runDeckMenu(d, project, "item:talks/defense/main.tex:3", "moveSlideDown")).toBe(false);
    expect(d.written.size).toBe(0);
  });
});
