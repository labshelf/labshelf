#!/usr/bin/env node
/**
 * Generates packages/core/src/ui/icons/tabler/tablerLibrary.ts, the curated research-topic icon library, from an extracted
 * @tabler/icons npm package (https://tabler.io/icons, MIT). Reads icons.json for tags and tabler-nodes-outline.json for the
 * outline geometry; the output is deterministic and sorted by name.
 *
 * Usage: node scripts/icons/buildTablerLibrary.mjs <extracted-package-dir> [--candidates]
 *   --candidates prints the outline icons whose names or tags match the topic keywords and are not curated yet, to help
 *   extend CURATED; it writes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "packages/core/src/ui/icons/tabler/tablerLibrary.ts");

/** The categories in picker order. */
const CATEGORIES = [
  "Math",
  "Science",
  "Biology",
  "Medicine",
  "Chemistry",
  "Physics",
  "Computing",
  "Engineering",
  "Earth & Space",
  "Data & Charts",
  "Humanities",
  "Social & Economics",
  "General",
];

/** The clearest, most distinct outline icon per topic, by category. */
const CURATED = {
  Math: ["math-function", "math-integral", "sum"],
  Science: ["microscope", "bulb", "report-search"],
  Biology: ["dna", "leaf", "virus", "paw"],
  Medicine: ["heartbeat", "stethoscope", "pill"],
  Chemistry: ["flask", "test-pipe", "hexagons"],
  Physics: ["atom", "magnet", "wave-sine", "radioactive"],
  Computing: ["code", "terminal", "cpu", "database"],
  Engineering: ["tools", "settings", "building-factory"],
  "Earth & Space": ["world", "planet", "telescope"],
  "Data & Charts": ["chart-bar", "chart-line", "chart-pie", "chart-dots"],
  Humanities: ["books", "language", "gavel", "music"],
  "Social & Economics": ["users", "coins", "building-bank", "heart-handshake"],
  General: ["folder", "file", "book", "notebook", "star", "bookmark"],
};

/** Labels where the Tabler name does not read as the topic. */
const LABELS = {
  "hexagons": "Molecule",
  "test-pipe": "Test tube",
  "report-search": "Research",
  "math-function": "Function",
  "math-integral": "Integral",
  "sum": "Sum (sigma)",
  "wave-sine": "Sine wave",
  "paw": "Animal",
  "bulb": "Idea",
  "settings": "Gear",
  "building-factory": "Factory",
  "building-bank": "Bank",
  "heart-handshake": "Community",
  "gavel": "Law",
  "world": "Globe",
  "chart-dots": "Scatter plot",
};

/** Extra search words where Tabler's tags miss the research topic. */
const EXTRA_TAGS = {
  "hexagons": ["molecule", "chemistry", "benzene"],
  "test-pipe": ["test-tube", "chemistry", "lab"],
  "flask": ["chemistry", "lab"],
  "sum": ["sigma", "math"],
  "math-function": ["math", "function"],
  "math-integral": ["math", "calculus"],
  "atom": ["physics"],
  "magnet": ["physics"],
  "wave-sine": ["physics", "wave"],
  "paw": ["animal", "zoology"],
  "world": ["earth", "geography", "globe"],
  "chart-dots": ["statistics", "scatter"],
  "gavel": ["law"],
  "coins": ["economics", "finance"],
};

const KEYWORDS =
  "math mathematics sigma function calculator geometry statistics chart graph science lab flask microscope atom biology bio dna cell virus bacteria leaf plant tree animal brain heart medical health pill computer code terminal cpu server database cloud network robot ai physics magnet bolt rocket planet telescope wave chemistry molecule test-tube earth geography map globe weather climate engineering tools gear building economics coin finance social users language book school music art history law".split(
    " ",
  );

const STROKE_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Turns Tabler's `[tag, attrs]` nodes into inner SVG markup. */
function bodyOf(nodes) {
  return nodes
    .map(([tag, attrs]) => `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("")}/>`)
    .join("");
}

function labelOf(name) {
  const words = name.replace(/-\d+$/, "").split("-").join(" ");
  return LABELS[name] ?? words.charAt(0).toUpperCase() + words.slice(1);
}

function tagsOf(name, meta) {
  const tags = [...(meta.tags ?? []), ...(EXTRA_TAGS[name] ?? [])].map((t) => String(t).toLowerCase().trim()).filter(Boolean);
  return [...new Set(tags)].sort();
}

function collect(pkgDir) {
  const meta = readJson(path.join(pkgDir, "icons.json"));
  const nodes = readJson(path.join(pkgDir, "tabler-nodes-outline.json"));
  const icons = [];
  const seen = new Set();
  for (const category of CATEGORIES) {
    for (const name of CURATED[category]) {
      if (seen.has(name)) throw new Error(`${name} is curated twice`);
      seen.add(name);
      if (!meta[name]?.styles?.outline || !nodes[name]) throw new Error(`${name} has no outline icon in ${pkgDir}`);
      icons.push({ name, label: labelOf(name), category, tags: tagsOf(name, meta[name]), body: bodyOf(nodes[name]) });
    }
  }
  icons.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { icons, meta, nodes, seen, version: readJson(path.join(pkgDir, "package.json")).version };
}

function printCandidates({ meta, nodes, seen }) {
  for (const name of Object.keys(meta).sort()) {
    if (seen.has(name) || !nodes[name] || !meta[name].styles?.outline) continue;
    const words = new Set([name, ...name.split("-"), ...(meta[name].tags ?? []).map((t) => String(t).toLowerCase())]);
    const hits = KEYWORDS.filter((k) => words.has(k));
    if (hits.length) console.log(`${name}\t${meta[name].category}\t${hits.join(",")}`);
  }
}

function render({ icons, version }) {
  const rows = icons
    .map((i) => `  { name: ${JSON.stringify(i.name)}, label: ${JSON.stringify(i.label)}, category: ${JSON.stringify(i.category)}, tags: ${JSON.stringify(i.tags)}, body: ${JSON.stringify(i.body)} },`)
    .join("\n");
  return `/**
 * Curated Tabler outline icons (https://tabler.io/icons, @tabler/icons ${version}, MIT; see LICENSE beside this file) for research topics, so a project can pick its own icon.
 * GENERATED by scripts/icons/buildTablerLibrary.mjs; do not edit by hand, change the script and re-run it.
 */

/** The topic groups of the library, in picker order. */
export const TABLER_CATEGORIES = ${JSON.stringify(CATEGORIES)} as const;

export type TablerCategory = (typeof TABLER_CATEGORIES)[number];

export interface TablerIcon {
  readonly name: string;
  readonly label: string;
  readonly category: TablerCategory;
  readonly tags: readonly string[];
  /** Inner SVG markup on a 24x24 grid, without the outer <svg>. */
  readonly body: string;
}

/** The library, sorted by name. */
export const TABLER_ICONS: readonly TablerIcon[] = [
${rows}
];

const STROKE_ATTRS =
  '${STROKE_ATTRS}';

const BY_NAME = new Map(TABLER_ICONS.map((icon) => [icon.name, icon]));

/** @returns the icon with that Tabler name, or undefined. */
export function findTablerIcon(name: string): TablerIcon | undefined {
  return BY_NAME.get(name);
}

/** @returns the icons whose name, label or tags contain the query (case-insensitive), optionally in one category; an empty query lists them all. */
export function searchTablerIcons(query: string, category?: TablerCategory): readonly TablerIcon[] {
  const needle = query.trim().toLowerCase();
  return TABLER_ICONS.filter(
    (icon) =>
      (category === undefined || icon.category === category) &&
      (needle === "" ||
        icon.name.includes(needle) ||
        icon.label.toLowerCase().includes(needle) ||
        icon.tags.some((tag) => tag.includes(needle))),
  );
}

/** @returns trusted SVG markup for the icon, drawn like the app's stroke icons, or null for an unknown name. */
export function renderTablerIcon(name: string): string | null {
  const icon = BY_NAME.get(name);
  return icon ? \`<svg \${STROKE_ATTRS}>\${icon.body}</svg>\` : null;
}
`;
}

const args = process.argv.slice(2);
const pkgDir = args.find((a) => !a.startsWith("--"));
if (!pkgDir) {
  console.error("usage: node scripts/icons/buildTablerLibrary.mjs <extracted @tabler/icons package dir> [--candidates]");
  process.exit(2);
}
const library = collect(path.resolve(pkgDir));
if (args.includes("--candidates")) {
  printCandidates(library);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, render(library));
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${library.icons.length} icons, ${fs.statSync(OUT).size} bytes`);
}
