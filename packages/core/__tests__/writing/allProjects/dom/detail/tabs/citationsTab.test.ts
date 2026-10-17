/**
 * @jest-environment jsdom
 */
import { citationsTabHtml } from "../../../../../../src/writing/allProjects/dom/detail/tabs/citationsTab";
import { detail } from "../fixtures";

const render = (html: string): HTMLElement => { const el = document.createElement("div"); el.innerHTML = html; return el; };

describe("citationsTabHtml", () => {
  const rows = [...render(citationsTabHtml(detail)).querySelectorAll(".ls-cite-row")];

  it("lists key, title, authors and year in key order", () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]!.querySelector(".cite-key")?.textContent).toBe("vaswani2017");
    expect(rows[0]!.textContent).toContain("Attention is all you need · Vaswani et al. · 2017");
  });

  it("says where a bib entry comes from and leads unresolved keys with Not found", () => {
    expect(rows[1]!.textContent).toContain("from refs.bib");
    expect(rows[2]!.firstElementChild?.className).toContain("cite-missing");
    expect(rows[2]!.textContent).toContain("Not found");
  });

  it("escapes titles and shows an empty state without citations", () => {
    expect(citationsTabHtml({ ...detail, citations: [{ key: "k", source: "library", title: "<b>" }] })).not.toContain("<b>");
    expect(render(citationsTabHtml({ ...detail, citations: [] })).querySelector(".muted-note")?.textContent).toBe("No citations yet.");
  });
});
