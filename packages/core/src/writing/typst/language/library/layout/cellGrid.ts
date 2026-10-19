// Builds the catalogue entries of `grid` and `table`, which share their parameters and cell, header and line members.
import { fn, named, pos, type TypstBuiltin, type TypstParam } from "../typstBuiltin";

export interface TypstGridKind {
  name: "grid" | "table";
  inset: string;
  stroke: string;
}

const TRACKS = "auto | int | relative | fraction | array";
const CELL_STROKE = "none | length | color | gradient | stroke | tiling | dictionary";
const children = (doc: string) => pos("children", "content", doc);

function styling(kind: TypstGridKind): TypstParam[] {
  return [
    named("inset", "relative | array | dictionary | function", kind.inset, "How much to pad the content of cells; an array or function sets it by column and row."),
    named("align", "auto | array | alignment | function", "auto", "How to align the content of cells."),
    named("fill", "none | color | gradient | array | tiling | function", "none", "How to fill cells; an array or function fills by column and row."),
    named("stroke", `${CELL_STROKE} | array | function`, kind.stroke, "How to stroke cells."),
  ];
}

const CELL_STYLING: readonly TypstParam[] = [
  named("inset", "auto | relative | dictionary", "auto", "How much to pad the cell's content; `auto` uses the container's inset."),
  named("align", "auto | alignment", "auto", "How to align the cell's content; `auto` uses the container's alignment."),
  named("fill", "none | auto | color | gradient | tiling", "auto", "How to fill the cell; `auto` uses the container's fill."),
  named("stroke", CELL_STROKE, "(:)", "How to stroke the cell, on top of the container's stroke."),
];

function line(kind: TypstGridKind, axis: "x" | "y"): TypstBuiltin {
  const horizontal = axis === "y";
  return fn(horizontal ? "hline" : "vline", `A ${horizontal ? "horizontal" : "vertical"} line in the ${kind.name}.`, [
    named(axis, "auto | int", "auto", `The ${horizontal ? "row" : "column"} above or before which the line is placed; \`auto\` uses the current position.`),
    named("start", "int", "0", `The ${horizontal ? "column" : "row"} at which the line starts.`),
    named("end", "none | int", "none", `The ${horizontal ? "column" : "row"} before which the line ends; \`none\` runs to the end.`),
    named("stroke", CELL_STROKE, "1pt + black", "The line's stroke."),
    named("position", "alignment", horizontal ? "top" : "start", `Which side of the ${horizontal ? "row" : "column"} the line is placed on.`),
  ], "content");
}

export function cellGrid(kind: TypstGridKind, doc: string): readonly TypstBuiltin[] {
  return [fn(kind.name, doc, [
    children(`The ${kind.name}'s cells, filled in row by row.`),
    named("columns", TRACKS, "()", "The column sizes: a count, or an array of sizes such as `(1fr, auto)`."),
    named("rows", TRACKS, "()", "The row sizes; rows past the given ones repeat the last size."),
    named("gutter", TRACKS, "()", "The gaps between rows and between columns."),
    named("column-gutter", TRACKS, "()", "The gaps between columns."),
    named("row-gutter", TRACKS, "()", "The gaps between rows."),
    ...styling(kind),
  ], "content", [
    fn("cell", `A cell of the ${kind.name}, used to override its position, span or styling.`, [
      pos("body", "content", "The cell's content."),
      named("x", "auto | int", "auto", "The cell's column, counting from zero."),
      named("y", "auto | int", "auto", "The cell's row, counting from zero."),
      named("colspan", "int", "1", "The number of columns the cell spans."),
      named("rowspan", "int", "1", "The number of rows the cell spans."),
      ...CELL_STYLING,
      named("breakable", "auto | bool", "auto", "Whether rows spanned by the cell may break across pages."),
    ], "content"),
    fn("header", `The header rows of the ${kind.name}, repeated on every page.`, [
      children("The header's cells."),
      named("repeat", "bool", "true", "Whether the header repeats across pages."),
      named("level", "int", "1", "The header's nesting level; a header replaces repeating headers of the same or a deeper level."),
    ], "content"),
    fn("footer", `The footer rows of the ${kind.name}, repeated on every page.`, [
      children("The footer's cells."),
      named("repeat", "bool", "true", "Whether the footer repeats across pages."),
    ], "content"),
    line(kind, "y"),
    line(kind, "x"),
  ])];
}
