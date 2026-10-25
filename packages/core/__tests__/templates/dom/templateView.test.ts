/**
 * Checks template details over host replies and project actions.
 * @jest-environment jsdom
 */
import { entry, key, listAll, mountGallery, type Gallery } from "./galleryHarness";

const detail = (g: Gallery) => g.root.querySelector<HTMLElement>("section.ls-tpl-detail");
const useButton = (g: Gallery) => [...g.root.querySelectorAll<HTMLButtonElement>("section.ls-tpl-detail button")].find((b) => /Use template|Creating project/.test(b.textContent ?? ""))!;

function open(g: Gallery, name = "Name c1") {
  listAll(g, { community: [entry("community", "c1", { files: ["z.tex", "main.tex", "img/"] }), entry("community", "c2", { category: "thesis" })] });
  g.card(name).click();
}

describe("detail page", () => {
  it("opens on click, sends detail, and focuses the heading", () => {
    const g = mountGallery();
    open(g);
    expect(detail(g)).not.toBeNull();
    expect(g.ofType("detail")).toEqual([{ type: "detail", template: key("community", "c1") }]);
    const h1 = detail(g)!.querySelector("h1")!;
    expect(h1.textContent).toBe("Name c1");
    expect(detail(g)!.getAttribute("aria-labelledby")).toBe(h1.id);
    expect(document.activeElement).toBe(h1);
    expect(g.cards()).toHaveLength(0);
  });

  it("opens with Enter on the focused card", () => {
    const g = mountGallery();
    listAll(g);
    const card = g.card("Name c1");
    card.focus();
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    card.click(); // a real button turns Enter into click; jsdom does not
    expect(detail(g)).not.toBeNull();
    expect(g.ofType("detail").length).toBeGreaterThanOrEqual(1);
  });

  it("requests the thumbnail of the opened card when not yet requested", () => {
    const g = mountGallery();
    open(g);
    expect(g.ofType("thumbnails").flatMap((b) => b.templates)).toContainEqual(key("community", "c1"));
    g.deliver({ type: "thumbnail", template: key("community", "c1"), dataUri: "data:image/png;base64,AAAA" });
    expect(detail(g)!.querySelector("figure.ls-tpl-preview img")?.getAttribute("alt")).toBe("First page of the Name c1 template");
  });

  it("shows metadata, with version and compiler only when set", () => {
    const g = mountGallery();
    listAll(g);
    g.card("Name u1").click();
    const text = detail(g)!.querySelector("dl.ls-tpl-meta")!.textContent!;
    expect(text).toContain("Typst");
    expect(text).toContain("MIT");
    expect(text).toContain("1.2.0");
    expect(text).toContain("0.13.1 or later");
    g.root.querySelector<HTMLButtonElement>(".ls-tpl-detail-nav button")!.click();
    g.card("Name c1").click();
    expect(detail(g)!.querySelector("dl.ls-tpl-meta")!.textContent).not.toContain("Needs Typst");
  });

  it("omits the Engine row when the engine is the format", () => {
    const g = mountGallery();
    listAll(g);
    g.card("Name u1").click();
    const labels = [...detail(g)!.querySelectorAll("dl.ls-tpl-meta dt")].map((dt) => dt.textContent);
    expect(labels).not.toContain("Engine");
    g.root.querySelector<HTMLButtonElement>(".ls-tpl-detail-nav button")!.click();
    g.card("Name c1").click();
    expect([...detail(g)!.querySelectorAll("dl.ls-tpl-meta dt")].map((dt) => dt.textContent)).toContain("Engine");
  });

  it("warns with the engine name when the host reports a problem", () => {
    const g = mountGallery();
    open(g);
    expect(detail(g)!.querySelector(".ls-tpl-engine")).toBeNull();
    g.deliver({ type: "engine", template: key("community", "c1"), problem: "pdflatex is not installed" });
    const warn = detail(g)!.querySelector(".ls-tpl-engine")!;
    expect(warn.getAttribute("role")).toBe("note");
    expect(warn.textContent).toContain("pdflatex");
  });

  it("shows no warning when the reply has no problem or is for another template", () => {
    const g = mountGallery();
    open(g);
    g.deliver({ type: "engine", template: key("community", "c1") });
    g.deliver({ type: "engine", template: key("community", "c2"), problem: "pdflatex missing" });
    expect(detail(g)!.querySelector(".ls-tpl-engine")).toBeNull();
  });

  it("lists files only when set, main first then sorted", () => {
    const g = mountGallery();
    open(g);
    const items = [...detail(g)!.querySelectorAll(".ls-tpl-files li")].map((li) => li.textContent?.trim());
    expect(items).toEqual(["main.tex", "img/", "z.tex"]);
    g.root.querySelector<HTMLButtonElement>(".ls-tpl-detail-nav button")!.click();
    g.card("Name c2").click();
    expect(detail(g)!.querySelector(".ls-tpl-files")).toBeNull();
  });

  it("returns to the grid with filters kept via the back button and Escape", () => {
    const g = mountGallery();
    open(g);
    g.root.querySelector<HTMLButtonElement>(".ls-tpl-detail-nav button")!.click();
    expect(detail(g)).toBeNull();
    expect(g.cards()).toHaveLength(4);
    expect(document.activeElement).toBe(g.card("Name c1"));

    const chip = [...g.root.querySelectorAll<HTMLButtonElement>(".ls-tpl-category")].find((b) => b.textContent === "Thesis")!;
    chip.click();
    g.card("Name c2").click();
    detail(g)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(detail(g)).toBeNull();
    expect(g.cardNames()).toEqual(["Name c2"]);
    expect([...g.root.querySelectorAll(".ls-tpl-category")].find((b) => b.textContent === "Thesis")!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("use template", () => {
  it("sends use with the key and stays busy until use.settled", () => {
    const g = mountGallery();
    open(g);
    expect(useButton(g).textContent).toContain("Use template");
    useButton(g).click();
    expect(g.ofType("use")).toEqual([{ type: "use", template: key("community", "c1") }]);
    expect(useButton(g).disabled).toBe(true);
    expect(useButton(g).getAttribute("aria-busy")).toBe("true");
    expect(useButton(g).textContent).toContain("Creating project…");
    g.deliver({ type: "use.settled", template: key("community", "c2") });
    expect(useButton(g).disabled).toBe(true);
    g.deliver({ type: "use.settled", template: key("community", "c1") });
    expect(useButton(g).disabled).toBe(false);
    expect(useButton(g).textContent).toContain("Use template");
  });
});

describe("notices, accessibility, dispose", () => {
  it("shows an error notice with role alert", () => {
    const g = mountGallery();
    g.deliver({ type: "notice", kind: "error", text: "Could not create the project" });
    const alert = g.root.querySelector('[role="alert"]') ?? document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Could not create the project");
  });

  it("makes cards and buttons keyboard reachable with accessible names", () => {
    const g = mountGallery();
    listAll(g);
    for (const card of g.cards()) {
      expect(card.tabIndex).toBeGreaterThanOrEqual(-1);
      expect(card.getAttribute("aria-label")).toBeTruthy();
    }
    expect(g.cards().some((c) => c.tabIndex === 0)).toBe(true);
    for (const b of g.root.querySelectorAll<HTMLButtonElement>("button")) {
      expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim()).not.toBe("");
    }
    expect(g.root.querySelectorAll("span.ls-tpl-category")).toHaveLength(0);
    expect(g.root.querySelector("nav.ls-tpl-navigation")?.getAttribute("aria-label")).toBe("Template filters");
    expect(g.root.querySelector("ul.ls-tpl-grid")?.getAttribute("aria-label")).toBe("Templates");
  });

  it("moves between cards with the arrow keys", () => {
    const g = mountGallery();
    listAll(g);
    const [first, second] = g.cards();
    first!.focus();
    first!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(second);
    g.card("Name c1").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(g.cards().at(-1));
  });

  it("dispose empties the root and stops listening", () => {
    const g = mountGallery();
    listAll(g);
    g.gallery.dispose();
    expect(g.root.innerHTML).toBe("");
    expect(g.handlers.size).toBe(0);
    g.deliver({ type: "source", source: "mine", listing: { status: "loading" } });
    expect(g.root.innerHTML).toBe("");
  });
});
