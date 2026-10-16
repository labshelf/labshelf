import type { CitationMapView } from "@labshelf/core";
import { citationGraph, missingNodeId } from "../../../src/library-ui/citationGraph";

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
    const g = citationGraph(map);
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([["a", "paper"], ["b", "paper"], [missingNodeId("W1"), "missing"], [missingNodeId("W2"), "missing"]]);
    expect(g.edges).toEqual([
      { from: "a", to: "b" },
      { from: "a", to: missingNodeId("W1") },
      { from: "b", to: missingNodeId("W1") },
      { from: "b", to: missingNodeId("W2") },
    ]);
  });

  it("grows a missing work's node with the papers citing it", () => {
    const [, , often, once] = citationGraph(map).nodes;
    expect(often!.radius).toBeGreaterThan(once!.radius);
  });
});
