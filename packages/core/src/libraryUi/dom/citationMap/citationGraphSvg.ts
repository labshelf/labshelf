// Draws the citation map's graph as inline SVG: library papers as filled dots, missing works as dashed rings.

import { escapeHtml } from "../../../ui/index.js";
import { GRAPH_MAX_RADIUS, citationGraph, forceLayout, type GraphNode, type Point } from "../../citationGraph/index.js";
import type { CitationMapView } from "../../protocol/index.js";

const BOX = { width: 640, height: 360, padding: GRAPH_MAX_RADIUS + 2 };

const round = (n: number): string => n.toFixed(1);

function nodeTitle(node: GraphNode, citing: number): string {
  return node.kind === "paper" ? node.title : `${node.title} (cited by ${citing} of your papers, not in your library)`;
}

function nodeMarkup(node: GraphNode, at: Point, citing: number): string {
  const act = node.kind === "paper" ? "open" : "show-work";
  const ref = node.kind === "paper" ? `data-id="${escapeHtml(node.ref)}"` : `data-work="${escapeHtml(node.ref)}"`;
  return `<circle class="cm-node cm-node-${node.kind}" cx="${round(at.x)}" cy="${round(at.y)}" r="${round(node.radius)}" data-act="${act}" ${ref}>` +
    `<title>${escapeHtml(nodeTitle(node, citing))}</title></circle>`;
}

/**
 * Builds the graph's SVG markup, or an empty string when there is nothing to connect.
 * The list beside it carries every action, so the picture is a mouse shortcut, hidden from assistive technology as one image.
 */
export function citationGraphSvg(map: CitationMapView): string {
  const graph = citationGraph(map);
  if (graph.edges.length === 0) return "";
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const pairs = graph.edges.map((e) => [index.get(e.from)!, index.get(e.to)!] as const);
  const at = forceLayout(graph.nodes.length, pairs, BOX);
  const citing = new Map(map.missing.map((w) => [w.workId, w.citedBy.length]));
  const edges = pairs.map(([a, b]) => {
    const kind = graph.nodes[b]!.kind === "missing" ? " cm-edge-missing" : "";
    return `<line class="cm-edge${kind}" x1="${round(at[a]!.x)}" y1="${round(at[a]!.y)}" x2="${round(at[b]!.x)}" y2="${round(at[b]!.y)}"/>`;
  });
  const nodes = graph.nodes.map((n, i) => nodeMarkup(n, at[i]!, citing.get(n.ref) ?? 0));
  const label = `Citation graph of ${map.papers.length} of your papers and ${map.missing.length} works not in your library`;
  return `<svg class="cm-graph" viewBox="0 0 ${BOX.width} ${BOX.height}" role="img" aria-label="${escapeHtml(label)}">` +
    `<g class="cm-edges">${edges.join("")}</g><g class="cm-nodes">${nodes.join("")}</g></svg>`;
}
