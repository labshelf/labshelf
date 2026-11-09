/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Spec 5.2 in the browser: openNewDeckDialog (the gallery inside an overlay: resolves the choice on Create, null on Cancel, Escape or a scrim click, and
// closes the overlay) and createDeck with an injected picker (what it asks the picker, the files it writes from the choice, undefined on null).
import {
  DECK_STYLE_PRESETS, DEFAULT_DECK_STYLE, scaffoldDeckFromTemplate,
  type DeckKit, type DeckTemplateChoice, type DeckTemplateGalleryInit, type ProjectEntry,
} from "@labshelf/core";
import { openNewDeckDialog } from "../../src/libraryUi/newDeckDialog";
import { createDeck } from "../../src/writing/session";

const KIT: DeckKit = { name: "Lab", style: { ...DEFAULT_DECK_STYLE, primary: "#112233" } };
const latexProject = { kind: "ready", folder: "/projects/p", location: "library", main: "main.tex", settings: { id: "p", format: "latex" } } as Extract<ProjectEntry, { kind: "ready" }>;
const typstProject = { kind: "ready", folder: "/projects/p", location: "library", main: "main.typ", settings: { id: "p", format: "typst" } } as Extract<ProjectEntry, { kind: "ready" }>;

/** The files createDeck writes, in memory. */
function writableFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    exists: async (path: string) => files.has(path) || dirs.has(path),
    ensureDir: async (path: string) => { dirs.add(path); },
    writeText: async (path: string, text: string) => { files.set(path, text); },
  };
}

const text = (el: Element): string => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const tick = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); };
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".dtg");
const control = (label: string): HTMLButtonElement => {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => text(b) === label || b.getAttribute("aria-label") === label);
  if (!found) throw new Error(`no ${label} button`);
  return found;
};
const typeTitle = (value: string): void => {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Title"]');
  if (!input) throw new Error("no Title input");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const settled = <T>(promise: Promise<T>): Promise<{ done: boolean; value?: T }> =>
  Promise.race([promise.then((value) => ({ done: true, value })), tick().then(() => ({ done: false }))]);

afterEach(() => { document.body.innerHTML = ""; });

describe("openNewDeckDialog", () => {
  it("5.2d mounts the gallery in the page and resolves null on Cancel, closing the overlay", async () => {
    const result = openNewDeckDialog({ formats: ["html"], kits: [] });
    await tick();
    expect(dialog()).not.toBeNull();
    control("Cancel").click();
    await expect(result).resolves.toBeNull();
    expect(dialog()).toBeNull();
    expect(document.querySelector(".ls-scrim")).toBeNull();
  });

  it("5.2d resolves null on Escape and closes the overlay", async () => {
    const result = openNewDeckDialog({ formats: ["html"], kits: [] });
    await tick();
    document.querySelector('input[aria-label="Title"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await expect(result).resolves.toBeNull();
    expect(dialog()).toBeNull();
  });

  it("5.2d resolves null when the scrim is pressed and closes the overlay", async () => {
    const result = openNewDeckDialog({ formats: ["html"], kits: [] });
    await tick();
    document.querySelector(".ls-scrim")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await expect(result).resolves.toBeNull();
    expect(dialog()).toBeNull();
  });

  it("5.2b resolves the choice on Create and closes the overlay", async () => {
    const result = openNewDeckDialog({ kind: "talk", formats: ["html"], kits: [] });
    await tick();
    expect((await settled(result)).done).toBe(false);
    typeTitle("  Thesis defence ");
    control("Create").click();
    await expect(result).resolves.toEqual({
      kind: "talk", format: "html", template: "generic", title: "Thesis defence", size: { w: 1920, h: 1080, unit: "px" }, style: null,
    });
    expect(dialog()).toBeNull();
  });

  it("5.2b resolves a Kit's style when the Kit palette is pressed", async () => {
    const result = openNewDeckDialog({ kind: "poster", formats: ["html"], kits: [KIT] });
    await tick();
    control("Better Poster").click();
    control("Kit: Lab").click();
    typeTitle("Kit poster");
    control("Create").click();
    await expect(result).resolves.toMatchObject({ kind: "poster", template: "better-poster", style: KIT.style });
  });

  it("5.2a passes the init to the gallery: a given kind, the formats and the kits", async () => {
    const result = openNewDeckDialog({ kind: "poster", formats: ["html", "latex"], kits: [KIT] });
    await tick();
    expect(text(dialog()!)).toContain("New poster");
    expect(document.querySelector('[aria-label="Kind"]')).toBeNull();
    expect(Array.from(document.querySelectorAll('[aria-label="Format"] button')).map(text)).toEqual(["Visual", "LaTeX"]);
    expect(document.querySelector('[aria-label="Kit: Lab"]')).not.toBeNull();
    control("Cancel").click();
    await result;
  });

  it("A6 shows the visual gallery with Better Poster and the user's Kits", async () => {
    const result = openNewDeckDialog({ kind: "poster", formats: ["html", "latex"], kits: [KIT] });
    await tick();
    expect(control("Better Poster")).toBeDefined();
    expect(text(dialog()!)).toContain("Your kits");
    expect(control("Kit: Lab")).toBeDefined();
    expect(document.querySelectorAll(".dtg-preview").length).toBeGreaterThanOrEqual(4);
    control("Cancel").click();
    await result;
  });
});

describe("createDeck with a picker", () => {
  const choice = (over: Partial<DeckTemplateChoice>): DeckTemplateChoice => ({
    kind: "talk", format: "html", template: "generic", title: "My Defense", size: { w: 1920, h: 1080, unit: "px" }, style: null, ...over,
  });

  it("5.2e asks the picker for the kind, the visual and the project's format, and no kits by default", async () => {
    const pick = jest.fn(async (_init: DeckTemplateGalleryInit) => null);
    await createDeck(writableFs(), latexProject, "talk", { pick });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.calls[0]![0]).toEqual({ kind: "talk", formats: ["html", "latex"], kits: [] });
  });

  it("5.2e asks a Typst project for the visual format only (Typst decks are off) and passes the given kits", async () => {
    const pick = jest.fn(async (_init: DeckTemplateGalleryInit) => null);
    await createDeck(writableFs(), typstProject, "poster", { kits: [KIT], pick });
    expect(pick.mock.calls[0]![0]).toEqual({ kind: "poster", formats: ["html"], kits: [KIT] });
  });

  it("5.2e returns undefined and writes nothing when the picker returns null", async () => {
    const fs = writableFs();
    expect(await createDeck(fs, latexProject, "talk", { pick: async () => null })).toBeUndefined();
    expect(fs.files.size).toBe(0);
    expect(await fs.exists("/projects/p/talks")).toBe(false);
  });

  it("5.2e writes a Better Poster HTML deck with a poster-takeaway and returns its path", async () => {
    const fs = writableFs();
    const picked = choice({ kind: "poster", template: "better-poster", title: "Big Poster", size: { w: 841, h: 1189, unit: "mm" } });
    expect(await createDeck(fs, latexProject, "poster", { pick: async () => picked })).toBe("posters/big-poster/deck.html");
    const html = fs.files.get("/projects/p/posters/big-poster/deck.html");
    expect(html).toContain("poster-takeaway");
    expect(fs.files.has("/projects/p/posters/big-poster/theme.css")).toBe(true);
  });

  it("5.2e writes exactly the files of scaffoldDeckFromTemplate under the folder name", async () => {
    const fs = writableFs();
    const picked = choice({ title: "My Defense", template: "blank" });
    expect(await createDeck(fs, latexProject, "talk", { pick: async () => picked })).toBe("talks/my-defense/deck.html");
    for (const file of scaffoldDeckFromTemplate(picked, "my-defense")) {
      expect(fs.files.get(`/projects/p/talks/my-defense/${file.path}`)).toBe(file.text);
    }
  });

  it("5.2e writes a styled LaTeX talk as main.tex with the style block", async () => {
    const fs = writableFs();
    const style = DECK_STYLE_PRESETS.find((p) => p.name === "Forest")!.style;
    const picked = choice({ format: "latex", title: "Beamer Talk", style });
    expect(await createDeck(fs, latexProject, "talk", { pick: async () => picked })).toBe("talks/beamer-talk/main.tex");
    const tex = fs.files.get("/projects/p/talks/beamer-talk/main.tex");
    expect(tex).toContain("labshelf:style");
  });

  it("5.2e refuses a Typst poster choice and writes nothing (Typst decks are off)", async () => {
    const fs = writableFs();
    const picked = choice({ kind: "poster", format: "typst", template: "billboard", title: "Typst Poster", size: { w: 841, h: 1189, unit: "mm" } });
    await expect(createDeck(fs, typstProject, "poster", { pick: async () => picked })).rejects.toThrow(RangeError);
    expect(fs.files.size).toBe(0);
  });

  it("5.2e picks a free folder name when the title's folder exists", async () => {
    const fs = writableFs();
    await fs.ensureDir("/projects/p/talks/my-defense");
    const path = await createDeck(fs, latexProject, "talk", { pick: async () => choice({ title: "My Defense" }) });
    expect(path).toMatch(/^talks\/my-defense[^/]+\/deck\.html$/);
    expect(path).not.toBe("talks/my-defense/deck.html");
  });

  it("A6 without a picker the gallery opens in the page and Cancel returns undefined", async () => {
    const fs = writableFs();
    const result = createDeck(fs, latexProject, "poster");
    await tick();
    expect(text(dialog()!)).toContain("New poster");
    expect(control("Better Poster")).toBeDefined();
    control("Cancel").click();
    await expect(result).resolves.toBeUndefined();
    expect(fs.files.size).toBe(0);
  });
});
