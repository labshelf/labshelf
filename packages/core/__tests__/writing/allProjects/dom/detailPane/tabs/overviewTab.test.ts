/**
 * @jest-environment jsdom
 */
import { renderOverviewTabHtml } from "../../../../../../src/writing/allProjects/dom/projectDetailTabs";
import type { ProjectPaneContent } from "../../../../../../src/writing/allProjects/index";
import { NOW, detail, row } from "../fixtures";

const render = (d: ProjectPaneContent, collapsed: Record<string, boolean> = {}): HTMLElement => {
  const el = document.createElement("div");
  el.innerHTML = renderOverviewTabHtml(row, d, collapsed, NOW);
  return el;
};
const withPages = (counted: number, limit: number): ProjectPaneContent => ({ ...detail, limits: { countUpTo: "end", pages: { counted, limit } } });

describe("renderOverviewTabHtml", () => {
  const view = render(detail);

  it("shows the venue with an edit button, the counts and the limit sentence", () => {
    const target = view.querySelector("[data-sec-body=target]")!;
    expect(target.textContent).toContain("ICLR 2027 · due in 41 days");
    expect(target.querySelector("[data-action=editTarget]")).not.toBeNull();
    expect(target.textContent).toContain("8 / 9");
    expect(target.textContent).toContain("5,120");
    expect(target.textContent).toContain("1 page left · counted up to the references");
  });

  it("marks the limit bar at and past the limit", () => {
    expect(view.querySelector(".ls-limit-bar")?.className).toBe("ls-limit-bar");
    expect(render(withPages(9, 9)).querySelector(".ls-limit-bar")?.classList.contains("at-limit")).toBe(true);
    expect(render(withPages(11, 9)).querySelector(".ls-limit-bar")?.classList.contains("past-limit")).toBe(true);
    expect(render({ ...detail, limits: { countUpTo: "end" } }).querySelector(".ls-limit-bar")).toBeNull();
  });

  it("offers Build now and Open log, the latter only with a log", () => {
    const build = view.querySelector("[data-sec-body=build]")!;
    expect(build.textContent).toContain("xelatex");
    expect(build.textContent).toContain("Overfull hbox");
    expect(build.querySelector("[data-action=build]")?.textContent).toBe("Build now");
    expect(build.querySelector("[data-action=openLog]")?.textContent).toBe("Open log");
    const unlogged: ProjectPaneContent = { ...detail };
    delete unlogged.log;
    expect(render(unlogged).querySelector("[data-action=openLog]")).toBeNull();
  });

  it("uses the tray's bibliography sentence with the entry count as the section count", () => {
    const bib = view.querySelector("[data-sec=bibliography]")!;
    expect(bib.querySelector(".sec-count")?.textContent).toBe("12");
    expect(view.querySelector("[data-sec-body=bibliography]")?.textContent).toContain("12 entries written from the library · synced 2 h ago");
  });

  it("collapses Location by default and escapes the paths", () => {
    const escaped = render({ ...detail, location: "/lib/<odd>/attn" });
    expect(escaped.querySelector("[data-sec=location]")?.classList.contains("collapsed")).toBe(true);
    expect(escaped.querySelector("[data-sec-body=location]")?.textContent).toContain("/lib/<odd>/attn");
    expect(escaped.innerHTML).not.toContain("<odd>");
    expect(render(detail, { location: false }).querySelector("[data-sec=location]")?.classList.contains("collapsed")).toBe(false);
  });

  it("says when the project lives outside the library", () => {
    const el = document.createElement("div");
    el.innerHTML = renderOverviewTabHtml({ ...row, external: true }, detail, {}, NOW);
    expect(el.querySelector("[data-sec-body=location]")?.textContent).toContain("Outside the library");
  });
});
