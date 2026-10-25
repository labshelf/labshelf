/**
 * @jest-environment jsdom
 */
import { projectDetailHeadHtml } from "../../../../../src/writing/allProjects/dom/detailPane/projectDetailPaneHead";
import { NOW, detail, row } from "./fixtures";

const render = (html: string): HTMLElement => { const el = document.createElement("div"); el.innerHTML = html; return el; };

describe("projectDetailHeadHtml", () => {
  const head = render(projectDetailHeadHtml(row, detail, { openLabel: "Open in VS Code", now: NOW }));

  it("escapes the title and shows the meta line", () => {
    expect(head.querySelector(".detail-title")?.textContent).toBe("Attention <is> all");
    expect(head.innerHTML).not.toContain("<is>");
    expect(head.querySelector(".detail-meta")?.textContent).toBe("LaTeX · main.tex · 8 pages · modified 2 h ago");
  });

  it("offers the more menu, the open button with the host's label and Preview", () => {
    expect(head.querySelector(".head-more [data-action=more]")).not.toBeNull();
    expect(head.querySelector(".detail-toolbar .open-btn[data-action=open]")?.textContent).toBe("Open in VS Code");
    expect(head.querySelector(".detail-toolbar [data-action=preview]")?.textContent).toBe("Preview");
  });

  it("shows the build dot with its status and the target with the days left", () => {
    const status = head.querySelector(".detail-status-row")!;
    expect(status.querySelector(".ls-build-dot")?.className).toContain("b-warnings");
    expect(status.textContent).toContain("2 warnings");
    expect(status.querySelector("svg")).not.toBeNull();
    expect(status.textContent).toContain("ICLR 2027 · 41 d");
  });

  it("drops the target without a venue or deadline and reads the status from the row before the detail arrives", () => {
    const bare = render(projectDetailHeadHtml({ id: "x", title: "t", place: "projects", build: { state: "ok" } }, undefined, { openLabel: "Open", now: NOW }));
    expect(bare.querySelector(".detail-status-row svg")).toBeNull();
    expect(bare.querySelector(".detail-status-row")?.textContent).toBe("Built");
  });
});
