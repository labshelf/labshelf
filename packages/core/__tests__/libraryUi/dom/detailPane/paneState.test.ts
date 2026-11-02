/**
 * @jest-environment jsdom
 */
// Tests the detail pane's shared markup pieces: sections, fields, icon and copy buttons, and the muted and loading lines.
import { copyBtn, renderField, renderLoading, renderMuted, renderSection } from "../../../../src/libraryUi/dom/detailPane/paneState";

const parse = (html: string): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

describe("renderSection", () => {
  it("renders an open section with its title, count and body", () => {
    const root = parse(renderSection("abstract", "Abstract", "<p>Body</p>", {}, { count: 3 }));
    const head = root.querySelector(".sec-head")!;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(head.classList.contains("collapsed")).toBe(false);
    expect(head.querySelector(".sec-title")?.textContent).toBe("Abstract");
    expect(head.querySelector(".sec-count")?.textContent).toBe("3");
    expect(root.querySelector("[data-sec-body='abstract']")?.classList.contains("hidden")).toBe(false);
  });

  it("hides the body of a folded section and shows no count of zero", () => {
    const root = parse(renderSection("abstract", "Abstract", "<p>Body</p>", { abstract: true }, { count: 0 }));
    expect(root.querySelector(".sec-head")?.classList.contains("collapsed")).toBe(true);
    expect(root.querySelector(".sec-head")?.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector(".sec-count")).toBeNull();
    expect(root.querySelector("[data-sec-body='abstract']")?.classList.contains("hidden")).toBe(true);
  });
});

describe("pane markup pieces", () => {
  it("escapes a field's label and keeps its value markup", () => {
    const root = parse(renderField("A & B", "<b>v</b>"));
    expect(root.querySelector(".kv-label")?.textContent).toBe("A & B");
    expect(root.querySelector(".kv-value b")?.textContent).toBe("v");
  });

  it("builds a copy button that carries the text and its label", () => {
    const button = parse(copyBtn('a "quoted" key', "key")).querySelector<HTMLButtonElement>("button")!;
    expect(button.dataset["action"]).toBe("copyField");
    expect(button.dataset["text"]).toBe('a "quoted" key');
    expect(button.getAttribute("aria-label")).toBe("Copy key");
  });

  it("escapes muted text and marks a loading line", () => {
    expect(parse(renderMuted("<none>")).querySelector(".muted-note")?.textContent).toBe("<none>");
    expect(parse(renderLoading()).querySelector(".pane-loading")?.textContent).toContain("Loading");
  });
});
