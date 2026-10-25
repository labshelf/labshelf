/**
 * @jest-environment jsdom
 */
import { renderVersionsTabHtml } from "../../../../../../src/writing/allProjects/dom/detailPane/tabs/versionsTab";
import { NOW, detail } from "../fixtures";

const render = (html: string): HTMLElement => { const el = document.createElement("div"); el.innerHTML = html; return el; };

describe("renderVersionsTabHtml", () => {
  it("lists each version with its name and age", () => {
    const row = render(renderVersionsTabHtml(detail.versions, NOW)).querySelector(".ls-version-row")!;
    expect(row.querySelector(".version-name")?.textContent).toBe("v2-submitted");
    expect(row.querySelector(".version-time")?.textContent).toBe("3 d");
  });

  it("escapes names and shows an empty state without versions", () => {
    expect(renderVersionsTabHtml([{ name: "<x>", created: detail.versions[0]!.created }], NOW)).not.toContain("<x>");
    expect(render(renderVersionsTabHtml([], NOW)).querySelector(".muted-note")?.textContent).toBe("No versions yet.");
  });
});
