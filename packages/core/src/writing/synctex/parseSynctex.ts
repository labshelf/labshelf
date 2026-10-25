// Parses the decompressed text of a SyncTeX file into boxes per page and the first position of each source line.
import { normalizeInputPath } from "./normalizeInputPath.js";
import type { SyncBox, SyncFileLines, SyncIndex, SyncMark, SyncNode } from "./synctexMap.js";

// 65536 sp per TeX point, 72.27 TeX points per 72 PDF points.
const SP_PER_POINT = 65781.76;

interface SyncScale {
  /** Converts a horizontal position. */
  x(raw: number): number;
  /** Converts a vertical position. */
  y(raw: number): number;
  /** Converts a width, height or depth. */
  size(raw: number): number;
}

function headerValue(text: string, key: string): number | undefined {
  const match = new RegExp(`^${key}:\\s*(-?\\d+)`, "m").exec(text);
  return match ? Number(match[1]) : undefined;
}

/**
 * Reads Unit, Magnification and the offsets from the preamble; a post scriptum (added by `synctex update`) overrides them.
 * Magnification scales coordinates and sizes but not the offsets; Unit scales all three. Checked against `synctex view`.
 */
function readSyncScale(text: string): SyncScale {
  const contentAt = text.indexOf("\nContent:");
  const postAt = text.lastIndexOf("\nPost scriptum:");
  const header = contentAt === -1 ? text : text.slice(0, contentAt);
  const post = postAt === -1 ? "" : text.slice(postAt);
  const read = (key: string): number | undefined => headerValue(post, key) ?? headerValue(header, key);
  const unit = read("Unit");
  const magnification = read("Magnification");
  const factor = ((unit !== undefined && unit > 0 ? unit : 8192) / SP_PER_POINT);
  const zoom = (magnification !== undefined && magnification > 0 ? magnification : 1000) / 1000;
  const xOffset = read("X Offset") ?? 0;
  const yOffset = read("Y Offset") ?? 0;
  return {
    x: (raw) => (raw * zoom + xOffset) * factor,
    y: (raw) => (raw * zoom + yOffset) * factor,
    size: (raw) => raw * zoom * factor,
  };
}

// PDF points: marks this close to the right edge of their line box are line-end glue.
const LINE_END_TOLERANCE = 0.5;

interface Row {
  tag: number;
  line: number;
  h: number;
  v: number;
  width: number;
  height: number;
  depth: number;
}

/** `tag,line[,column]:h,v[:width[,height,depth]]`, the part of a record after its type character. */
function parseRow(rest: string): Row {
  const [ids = "", pos = "", size = ""] = rest.split(":");
  const [tag = 0, line = 0] = ids.split(",").map(Number);
  const [h = 0, v = 0] = pos.split(",").map(Number);
  const [width = 0, height = 0, depth = 0] = size === "" ? [] : size.split(",").map(Number);
  return { tag, line, h, v, width, height, depth };
}

class IndexBuilder {
  private readonly files = new Map<number, string>();
  private readonly pages = new Map<number, SyncNode[]>();
  private readonly byFile = new Map<string, SyncFileLines>();
  private readonly open: SyncBox[] = [];
  private page = 0;
  private top: SyncNode[] = [];

  constructor(private readonly scale: SyncScale, private readonly cwd: string) {}

  add(row: string): void {
    const rest = row.slice(1);
    switch (row[0]) {
      case "I": this.input(rest); break;
      case "{": this.page = Number(rest); this.top = []; this.pages.set(this.page, this.top); break;
      case "}": this.open.length = 0; break;
      case "[": case "(": this.box(parseRow(rest), true, row[0] === "("); break;
      case "h": case "v": this.box(parseRow(rest), false, true); break;
      case "g": case "k": case "$": this.mark(parseRow(rest), row[0] === "k"); break;
      case "]": case ")": this.open.pop(); break;
      default:
    }
  }

  build(): SyncIndex {
    for (const lines of this.byFile.values()) { lines.lines = [...lines.positions.keys()].sort((a, b) => a - b); }
    return { files: this.files, pages: this.pages, byFile: this.byFile };
  }

  private input(rest: string): void {
    const match = /^nput:(\d+):(.*)$/.exec(rest.trimEnd());
    if (match) { this.files.set(Number(match[1]), normalizeInputPath(match[2] ?? "", this.cwd)); }
  }

  private attach(node: SyncNode): void {
    (this.open.at(-1)?.children ?? this.top).push(node);
  }

  // TRAP: TeX attributes the empty header and footer boxes of a page to the line that ended it, so boxes without height do not stand for their line.
  /** A vbox is a container only; hboxes and void boxes stand for their source line. */
  private box(row: Row, opens: boolean, marksLine: boolean): void {
    const { scale } = this;
    const left = scale.x(row.h);
    const baseline = scale.y(row.v);
    const box: SyncBox = {
      tag: row.tag, line: row.line, left, right: left + scale.size(row.width),
      top: baseline - scale.size(row.height), bottom: baseline + scale.size(row.depth), baseline, children: [],
    };
    this.attach(box);
    if (opens) { this.open.push(box); }
    if (marksLine && (row.height > 0 || row.depth > 0)) { this.note(row, left, baseline, false); }
  }

  private mark(row: Row, kern: boolean): void {
    const x = this.scale.x(row.h);
    const y = this.scale.y(row.v);
    const mark: SyncMark = { tag: row.tag, line: row.line, x, y, right: kern ? x + Math.max(0, this.scale.size(row.width)) : x };
    this.attach(mark);
    // TRAP: the glue and kern that end a line sit at its right edge and carry the line where the paragraph ended.
    const edge = this.open.at(-1)?.right ?? Infinity;
    if (x < edge - LINE_END_TOLERANCE) { this.note(row, x, y, true); }
  }

  /** Keeps the first mark of a line in reading order, or its first box when no mark exists: boxes carry the line where a paragraph ended. */
  private note(row: Row, x: number, y: number, mark: boolean): void {
    const file = this.files.get(row.tag);
    if (file === undefined) { return; }
    const lines = this.byFile.get(file) ?? { positions: new Map(), lines: [] };
    this.byFile.set(file, lines);
    const known = lines.positions.get(row.line);
    if (!known || (!known.mark && mark)) { lines.positions.set(row.line, { page: this.page, x, y, mark }); }
  }
}

/** Reads the records of a SyncTeX file; `cwd` is the folder the build ran in, which relative input paths are resolved against. */
export function parseSynctex(text: string, cwd: string): SyncIndex {
  if (!text.startsWith("SyncTeX Version:")) { throw new Error("Not a SyncTeX file: the version line is missing"); }
  const builder = new IndexBuilder(readSyncScale(text), cwd);
  for (const row of text.split("\n")) {
    if (row.startsWith("Postamble:")) { break; }
    builder.add(row);
  }
  return builder.build();
}
