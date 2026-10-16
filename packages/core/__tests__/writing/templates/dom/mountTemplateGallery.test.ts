/**
 * @jest-environment jsdom
 */
import { key, listAll, mountGallery } from "./galleryHarness";

const sourceRow = (g: ReturnType<typeof mountGallery>, label: string) =>
  [...g.root.querySelectorAll<HTMLElement>("li.ls-tpl-source")].find((r) => r.textContent?.includes(label))!;
const formatBox = (g: ReturnType<typeof mountGallery>, label: string) =>
  [...g.root.querySelectorAll<HTMLLabelElement>("label.ls-checkbox")].find((l) => l.textContent?.includes(label))!.querySelector("input")!;
const chip = (g: ReturnType<typeof mountGallery>, label: string) =>
  [...g.root.querySelectorAll<HTMLButtonElement>(".ls-tpl-category")].find((b) => b.textContent === label)!;
function search(g: ReturnType<typeof mountGallery>, text: string): void {
  const input = g.root.querySelector<HTMLInputElement>("input[type=search]")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("mount and listings", () => {
  it("posts ready on mount and shows loading rows and skeleton cards", () => {
    const g = mountGallery();
    expect(g.sent).toEqual([{ type: "ready" }]);
    g.deliver({ type: "source", source: "community", listing: { status: "loading" } });
    expect(g.root.querySelectorAll('li.ls-tpl-source [aria-label="Loading"]').length).toBeGreaterThan(0);
    expect(g.root.querySelectorAll("li.ls-tpl-card.is-loading").length).toBe(3);
    expect(g.cards()).toHaveLength(0);
  });

  it("shows cards of all sources in source order under All", () => {
    const g = mountGallery();
    listAll(g);
    expect(g.cardNames()).toEqual(["Name c1", "Name c2", "Name u1", "Name m1"]);
    const c1 = g.card("Name c1");
    expect(c1.querySelector(".ls-tpl-card-by")?.textContent).toBe("Ada · LabShelf Community");
    expect(c1.querySelector(".ls-tpl-card-meta")?.textContent).toBe("LaTeX · pdfLaTeX · Article");
    expect(g.card("Name u1").querySelector(".ls-tpl-card-meta")?.textContent).toBe("Typst · Article");
    expect(g.root.querySelector("li.ls-tpl-card.is-loading")).toBeNull();
  });

  it("shows the cached note for the cached source only", () => {
    const g = mountGallery();
    listAll(g);
    g.deliver({ type: "source", source: "universe", listing: { status: "ready", entries: [], fromCache: true } });
    expect(sourceRow(g, "Typst Universe").querySelector(".ls-tpl-source-note")?.textContent).toContain("cached");
    expect(sourceRow(g, "My templates").querySelector(".ls-tpl-source-note")?.textContent).not.toContain("cached");
  });

  it("shows an error row for a failed source while other sources keep their cards", () => {
    const g = mountGallery();
    listAll(g);
    g.deliver({ type: "source", source: "universe", listing: { status: "error", message: "offline" } });
    const err = g.root.querySelector(".ls-tpl-source-error");
    expect(err?.getAttribute("role")).toBe("status");
    expect(err?.textContent).toContain("offline");
    expect(g.cardNames()).toEqual(["Name c1", "Name c2", "Name m1"]);
  });

  it("explains when every source failed", () => {
    const g = mountGallery();
    for (const source of ["community", "universe", "mine"] as const) g.deliver({ type: "source", source, listing: { status: "error", message: "x" } });
    expect(g.root.querySelector(".ls-empty-text")?.textContent).toBe("Templates could not be listed.");
  });

  it("refresh button posts refresh and turns the rows to loading", () => {
    const g = mountGallery();
    listAll(g);
    g.root.querySelector<HTMLButtonElement>('button[aria-label="Refresh templates"]')!.click();
    expect(g.ofType("refresh")).toHaveLength(1);
    expect(g.root.querySelectorAll('li.ls-tpl-source [aria-label="Loading"]').length).toBe(3);
  });
});

describe("facets", () => {
  it("filters by source row and selects it", () => {
    const g = mountGallery();
    listAll(g);
    sourceRow(g, "Typst Universe").click();
    expect(g.cardNames()).toEqual(["Name u1"]);
    expect(sourceRow(g, "Typst Universe").getAttribute("aria-selected")).toBe("true");
    sourceRow(g, "All sources").click();
    expect(g.cards()).toHaveLength(4);
  });

  it("filters by format checkboxes; both checked by default", () => {
    const g = mountGallery();
    listAll(g);
    expect(formatBox(g, "LaTeX").checked && formatBox(g, "Typst").checked).toBe(true);
    formatBox(g, "LaTeX").click();
    expect(g.cardNames()).toEqual(["Name u1"]);
    formatBox(g, "LaTeX").click();
    formatBox(g, "Typst").click();
    expect(g.cardNames()).toEqual(["Name c1", "Name c2", "Name m1"]);
  });

  it("filters by category chip, a real button with aria-pressed", () => {
    const g = mountGallery();
    listAll(g);
    expect(chip(g, "All").tagName).toBe("BUTTON");
    expect(chip(g, "All").getAttribute("aria-pressed")).toBe("true");
    chip(g, "Thesis").click();
    expect(g.cardNames()).toEqual(["Name c2"]);
    expect(chip(g, "Thesis").getAttribute("aria-pressed")).toBe("true");
    expect(chip(g, "All").getAttribute("aria-pressed")).toBe("false");
    chip(g, "All").click();
    expect(g.cards()).toHaveLength(4);
  });

  it("filters by search text and clears it with Escape", () => {
    const g = mountGallery();
    listAll(g);
    search(g, "u1");
    expect(g.cardNames()).toEqual(["Name u1"]);
    g.root.querySelector("input[type=search]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(g.root.querySelector<HTMLInputElement>("input[type=search]")!.value).toBe("");
    expect(g.cards()).toHaveLength(4);
  });

  it("shows the empty state when nothing matches", () => {
    const g = mountGallery();
    listAll(g);
    search(g, "zzzz");
    expect(g.cards()).toHaveLength(0);
    expect(g.root.querySelector(".ls-empty-text")?.textContent).toBe("No templates match these filters.");
    expect(g.root.querySelector(".ls-empty-hint")?.textContent).toBe("Clear the search or pick another category.");
  });
});

describe("thumbnails", () => {
  it("requests visible cards once and fills the image from the reply", () => {
    const g = mountGallery();
    listAll(g);
    g.reveal();
    g.reveal();
    const batches = g.ofType("thumbnails");
    expect(batches.flatMap((b) => b.templates)).toEqual([key("community", "c1"), key("community", "c2"), key("universe", "u1"), key("mine", "m1")]);
    expect(g.card("Name c1").querySelector("img")).toBeNull();
    expect(g.card("Name c1").querySelector(".ls-tpl-thumb")).not.toBeNull();
    g.deliver({ type: "thumbnail", template: key("community", "c1"), dataUri: "data:image/png;base64,AAAA" });
    const img = g.card("Name c1").querySelector("img")!;
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(img.getAttribute("alt")).toBe("");
  });

  it("keeps the placeholder when the reply has no dataUri", () => {
    const g = mountGallery();
    listAll(g);
    g.reveal();
    g.deliver({ type: "thumbnail", template: key("community", "c1") });
    expect(g.card("Name c1").querySelector("img")).toBeNull();
  });

  it("requests thumbnails again after a new listing for that source", () => {
    const g = mountGallery();
    listAll(g);
    g.reveal();
    const before = g.ofType("thumbnails").flatMap((b) => b.templates).length;
    listAll(g);
    g.reveal();
    expect(g.ofType("thumbnails").flatMap((b) => b.templates).length).toBeGreaterThan(before);
  });
});
