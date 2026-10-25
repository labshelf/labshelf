// Turns a citation map into the nodes and edges of its graph: library papers, missing works and who cites whom.

import type { CitationMapView } from "../protocol/index.js";

export interface GraphNode {
  /** A paper id, or a missing work's id from {@link createMissingGraphNodeId}. */
  id: string;
  kind: "paper" | "missing";
  /** The paper id or the work id the node stands for. */
  ref: string;
  title: string;
  radius: number;
}

interface GraphEdge {
  from: string;
  to: string;
}

export interface CitationMapGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const PAPER_RADIUS = 5;
const MAX_RADIUS = 14;

/** Keeps a work id from ever colliding with a paper id that happens to look like one. */
export const createMissingGraphNodeId = (workId: string): string => `work:${workId}`;

/** A missing work's node grows with the number of library papers citing it. */
const missingRadius = (citing: number): number => Math.min(MAX_RADIUS, PAPER_RADIUS + 2 * Math.sqrt(citing));

/** The largest radius any node can have, so a layout can keep every node inside its box. */
export const GRAPH_MAX_RADIUS = MAX_RADIUS;

/** Builds the graph; edges whose ends the map does not name are left out. */
export function createCitationMapGraph(map: CitationMapView): CitationMapGraph {
  const nodes: GraphNode[] = map.papers.map((p) => ({ id: p.id, kind: "paper", ref: p.id, title: p.title, radius: PAPER_RADIUS }));
  for (const work of map.missing) {
    nodes.push({ id: createMissingGraphNodeId(work.workId), kind: "missing", ref: work.workId, title: work.title, radius: missingRadius(work.citedBy.length) });
  }
  const known = new Set(nodes.map((n) => n.id));
  const candidates: GraphEdge[] = [
    ...map.links,
    ...map.missing.flatMap((w) => w.citedBy.map((from) => ({ from, to: createMissingGraphNodeId(w.workId) }))),
  ];
  const edges = candidates.filter((e) => known.has(e.from) && known.has(e.to)).map(({ from, to }) => ({ from, to }));
  return { nodes, edges };
}
