/**
 * @jest-environment jsdom
 */
import type { CitationMapView } from "@labshelf/core";
import { mountForTest, paper } from "../mountHarness";

const map: CitationMapView = {
  papers: [{ id: "a", title: "Paper A" }, { id: "b", title: "Paper B" }, { id: "c", title: "Paper C" }],
  links: [{ from: "a", to: "b" }],
  missing: [
    {
      workId: "W1", doi: "10.1/one", title: "Attention is all you need", year: 2017, citedByCount: 9000, citedBy: ["a", "b", "c"],
      authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
    },
    { workId: "W2", title: "A work without a DOI", authors: ["Ada Lovelace"], citedByCount: 4, citedBy: ["a", "b", "c"] },
  ],
};

function openMap(state: Parameters<ReturnType<typeof mountForTest>["host"]["post"]>[0] = { type: "citationMap.show", state: { status: "ready", map } }) {
  const t = mountForTest();
  t.snapshot([paper("a", "papers"), paper("b", "papers"), paper("c", "papers")]);
  t.host.post(state);
  const view = t.container.querySelector<HTMLElement>(".citation-map")!;
  const rows = (): HTMLElement[] => [...view.querySelectorAll<HTMLElement>(".cm-row")];
  const importButton = (workId: string): HTMLButtonElement =>
    rows().find((r) => r.dataset["work"] === workId)!.querySelector<HTMLButtonElement>(".cm-import")!;
  return { ...t, view, rows, importButton };
}

describe("citation map view", () => {
  it("takes the paper list's place and renders a row per missing work and the graph", () => {
    const t = openMap();
    expect(t.view.hidden).toBe(false);
    expect(t.container.querySelector(".ls-library")!.classList.contains("citation-map-open")).toBe(true);
    expect(t.rows().map((r) => r.dataset["work"])).toEqual(["W1", "W2"]);
    expect(t.rows()[0]!.querySelector(".cm-meta")!.textContent).toBe("Ashish Vaswani, Noam Shazeer, Niki Parmar et al. · 2017");
    expect(t.rows()[0]!.querySelector("summary")!.textContent).toBe("Cited by 3 of your papers");
    const svg = t.view.querySelector("svg.cm-graph")!;
    expect(svg.getAttribute("aria-label")).toMatch(/3 of your papers and 2 works/);
    expect(svg.querySelectorAll(".cm-node-paper")).toHaveLength(3);
    expect(svg.querySelectorAll(".cm-node-missing")).toHaveLength(2);
  });

  it("posts the import with the work id and DOI and shows the row as busy", () => {
    const t = openMap();
    t.importButton("W1").click();
    expect(t.sent).toContainEqual({ type: "citationMap.import", workId: "W1", doi: "10.1/one" });
    expect(t.importButton("W1").disabled).toBe(true);
    expect(t.importButton("W1").getAttribute("aria-busy")).toBe("true");
  });

  it("removes the row and its graph node once the host imported the work", () => {
    const t = openMap();
    t.importButton("W1").click();
    t.host.post({ type: "citationMap.imported", workId: "W1" });
    expect(t.rows().map((r) => r.dataset["work"])).toEqual(["W2"]);
    expect(t.view.querySelectorAll(".cm-node-missing")).toHaveLength(1);
  });

  it("clears the busy state when the import failed", () => {
    const t = openMap();
    t.importButton("W1").click();
    t.host.post({ type: "citationMap.importFailed", workId: "W1" });
    expect(t.importButton("W1").disabled).toBe(false);
    expect(t.importButton("W1").textContent).toBe("Import");
  });

  it("disables Import, with a reason, for a work without a DOI", () => {
    const t = openMap();
    const button = t.importButton("W2");
    expect(button.disabled).toBe(true);
    expect(button.closest("[title]")!.getAttribute("title")).toMatch(/no DOI/);
    button.click();
    expect(t.sent.some((m) => m.type === "citationMap.import")).toBe(false);
  });

  it("opens a citing paper from the Cited by list and from its graph node", () => {
    const t = openMap();
    t.rows()[0]!.querySelector<HTMLElement>('.cm-paper-link[data-id="b"]')!.click();
    t.view.querySelector<SVGElement>('.cm-node-paper[data-id="c"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(t.sent.filter((m) => m.type === "paper.open")).toEqual([{ type: "paper.open", id: "b" }, { type: "paper.open", id: "c" }]);
  });

  it("shows the empty state when no work is missing, and the loading state while the host looks", () => {
    const empty = openMap({ type: "citationMap.show", state: { status: "ready", map: { ...map, missing: [] } } });
    expect(empty.view.querySelector(".ls-empty-text")!.textContent).toMatch(/No often-cited works/);
    expect(empty.view.querySelector(".ls-empty-hint")!.textContent).toMatch(/at least 3 of your papers.*DOI/);
    const loading = openMap({ type: "citationMap.show", state: { status: "loading" } });
    expect(loading.view.querySelector(".list-loading")).not.toBeNull();
    expect(loading.rows()).toHaveLength(0);
  });

  it("asks the host again on Refresh and goes back to the paper list on Papers or a folder", () => {
    const t = openMap();
    t.click('.cm-header [data-act="refresh"]');
    expect(t.sent).toContainEqual({ type: "citationMap.refresh" });
    expect(t.view.querySelector(".list-loading")).not.toBeNull();
    t.click('.cm-header [data-act="back"]');
    expect(t.view.hidden).toBe(true);
    t.host.post({ type: "citationMap.show", state: { status: "ready", map } });
    t.host.post({ type: "navigate", folder: "papers" });
    expect(t.view.hidden).toBe(true);
    expect(t.lib.store.get().citationMap).toBeNull();
  });

  it("leaves the list keys alone while it is open", () => {
    const t = openMap();
    t.key("ArrowDown");
    expect(t.lib.store.get().cursor).toBeNull();
  });
});
