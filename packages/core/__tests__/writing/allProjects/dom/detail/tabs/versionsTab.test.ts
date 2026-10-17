/**
 * @jest-environment jsdom
 */
import { versionsTabHtml } from "../../../../../../src/writing/allProjects/dom/detail/tabs/versionsTab";
import { NOW, detail } from "../fixtures";

const render = (html: string): HTMLElement => { const el = document.createElement("div"); el.innerHTML = html; return el; };

describe("versionsTabHtml", () => {
  it("lists each version with its name and age", () => {
    const row = render(versionsTabHtml(detail.versions, NOW)).querySelector(".ls-version-row")!;
    expect(row.querySelector(".version-name")?.textContent).toBe("v2-submitted");
    expect(row.querySelector(".version-time")?.textContent).toBe("3 d");
  });

  it("escapes names and shows an empty state without versions", () => {
    expect(versionsTabHtml([{ name: "<x>", created: detail.versions[0]!.created }], NOW)).not.toContain("<x>");
    expect(render(versionsTabHtml([], NOW)).querySelector(".muted-note")?.textContent).toBe("No versions yet.");
  });
});
