import type { CitationMapView } from "@labshelf/core";
import { createCitationMapGraph, createMissingGraphNodeId } from "../../../src/libraryUi/citationMap";

const map: CitationMapView = {
  papers: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
  links: [{ from: "a", to: "b" }, { from: "a", to: "gone" }],
  missing: [
    { workId: "W1", title: "Often cited", authors: [], citedByCount: 10, citedBy: ["a", "b", "x"] },
    { workId: "W2", title: "Cited once", authors: [], citedByCount: 1, citedBy: ["b"] },
  ],
};

describe("citationGraph", () => {
  it("has a node per named paper and per missing work, and only edges between them", () => {
    const g = createCitationMapGraph(map);
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([["a", "paper"], ["b", "paper"], [createMissingGraphNodeId("W1"), "missing"], [createMissingGraphNodeId("W2"), "missing"]]);
    expect(g.edges).toEqual([
      { from: "a", to: "b" },
      { from: "a", to: createMissingGraphNodeId("W1") },
      { from: "b", to: createMissingGraphNodeId("W1") },
      { from: "b", to: createMissingGraphNodeId("W2") },
    ]);
  });

  it("grows a missing work's node with the papers citing it", () => {
    const [, , often, once] = createCitationMapGraph(map).nodes;
    expect(often!.radius).toBeGreaterThan(once!.radius);
  });
});
