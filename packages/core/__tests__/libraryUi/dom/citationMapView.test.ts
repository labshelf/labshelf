/**
 * @jest-environment jsdom
 */
// Tests the citation map view: its graph, the missing works and what the user can do with them.
import type { CitationMapView } from "@labshelf/core";
import { mountForTest, paper } from "./mountHarness";
import { createCitationMapGraph, createMissingGraphNodeId, deriveForceLayout } from "../../../src/libraryUi/dom/citationMapView";

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

const graphMap: CitationMapView = {
  papers: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
  links: [{ from: "a", to: "b" }, { from: "a", to: "gone" }],
  missing: [
    { workId: "W1", title: "Often cited", authors: [], citedByCount: 10, citedBy: ["a", "b", "x"] },
    { workId: "W2", title: "Cited once", authors: [], citedByCount: 1, citedBy: ["b"] },
  ],
};

describe("citationGraph", () => {
  it("has a node per named paper and per missing work, and only edges between them", () => {
    const g = createCitationMapGraph(graphMap);
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([["a", "paper"], ["b", "paper"], [createMissingGraphNodeId("W1"), "missing"], [createMissingGraphNodeId("W2"), "missing"]]);
    expect(g.edges).toEqual([
      { from: "a", to: "b" },
      { from: "a", to: createMissingGraphNodeId("W1") },
      { from: "b", to: createMissingGraphNodeId("W1") },
      { from: "b", to: createMissingGraphNodeId("W2") },
    ]);
  });

  it("grows a missing work's node with the papers citing it", () => {
    const [, , often, once] = createCitationMapGraph(graphMap).nodes;
    expect(often!.radius).toBeGreaterThan(once!.radius);
  });
});

const BOX = { width: 640, height: 360, padding: 16 };

function chainAndStar(n: number): Array<readonly [number, number]> {
  const edges: Array<readonly [number, number]> = [];
  for (let i = 1; i < n; i++) edges.push([i % 7 === 0 ? 0 : i - 1, i]);
  return edges;
}

describe("forceLayout", () => {
  it("places the same graph at the same points every time", () => {
    const edges = chainAndStar(40);
    expect(deriveForceLayout(40, edges, BOX)).toEqual(deriveForceLayout(40, edges, BOX));
  });

  it("keeps every point finite and inside the box less its padding", () => {
    for (const n of [1, 2, 5, 60]) {
      for (const p of deriveForceLayout(n, chainAndStar(n), BOX)) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(BOX.padding - 1e-9);
        expect(p.x).toBeLessThanOrEqual(BOX.width - BOX.padding + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(BOX.padding - 1e-9);
        expect(p.y).toBeLessThanOrEqual(BOX.height - BOX.padding + 1e-9);
      }
    }
  });

  it("never puts two nodes on one point, edges or not", () => {
    for (const edges of [[], chainAndStar(30)]) {
      const points = deriveForceLayout(30, edges, BOX);
      expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(30);
    }
  });

  it("returns nothing for no nodes and lays out 300 nodes quickly", () => {
    expect(deriveForceLayout(0, [], BOX)).toEqual([]);
    const started = Date.now();
    expect(deriveForceLayout(300, chainAndStar(300), BOX)).toHaveLength(300);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
