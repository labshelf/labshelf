// Builds the catalogue entries of `grid` and `table`, which share their parameters and cell, header and line members.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, type TypstBuiltin, type TypstParam } from "../typstBuiltin";

export interface TypstGridKind {
  name: "grid" | "table";
  inset: string;
  stroke: string;
}

const TRACKS = "auto | int | relative | fraction | array";
const CELL_STROKE = "none | length | color | gradient | stroke | tiling | dictionary";
const children = (doc: string) => createPositionalParam("children", "content", doc);

function styling(kind: TypstGridKind): TypstParam[] {
  return [
    createNamedParam("inset", "relative | array | dictionary | function", kind.inset, "How much to pad the content of cells; an array or function sets it by column and row."),
    createNamedParam("align", "auto | array | alignment | function", "auto", "How to align the content of cells."),
    createNamedParam("fill", "none | color | gradient | array | tiling | function", "none", "How to fill cells; an array or function fills by column and row."),
    createNamedParam("stroke", `${CELL_STROKE} | array | function`, kind.stroke, "How to stroke cells."),
  ];
}

const CELL_STYLING: readonly TypstParam[] = [
  createNamedParam("inset", "auto | relative | dictionary", "auto", "How much to pad the cell's content; `auto` uses the container's inset."),
  createNamedParam("align", "auto | alignment", "auto", "How to align the cell's content; `auto` uses the container's alignment."),
  createNamedParam("fill", "none | auto | color | gradient | tiling", "auto", "How to fill the cell; `auto` uses the container's fill."),
  createNamedParam("stroke", CELL_STROKE, "(:)", "How to stroke the cell, on top of the container's stroke."),
];

function line(kind: TypstGridKind, axis: "x" | "y"): TypstBuiltin {
  const horizontal = axis === "y";
  return createFunctionBuiltin(horizontal ? "hline" : "vline", `A ${horizontal ? "horizontal" : "vertical"} line in the ${kind.name}.`, [
    createNamedParam(axis, "auto | int", "auto", `The ${horizontal ? "row" : "column"} above or before which the line is placed; \`auto\` uses the current position.`),
    createNamedParam("start", "int", "0", `The ${horizontal ? "column" : "row"} at which the line starts.`),
    createNamedParam("end", "none | int", "none", `The ${horizontal ? "column" : "row"} before which the line ends; \`none\` runs to the end.`),
    createNamedParam("stroke", CELL_STROKE, "1pt + black", "The line's stroke."),
    createNamedParam("position", "alignment", horizontal ? "top" : "start", `Which side of the ${horizontal ? "row" : "column"} the line is placed on.`),
  ], "content");
}

export function createCellGrid(kind: TypstGridKind, doc: string): readonly TypstBuiltin[] {
  return [createFunctionBuiltin(kind.name, doc, [
    children(`The ${kind.name}'s cells, filled in row by row.`),
    createNamedParam("columns", TRACKS, "()", "The column sizes: a count, or an array of sizes such as `(1fr, auto)`."),
    createNamedParam("rows", TRACKS, "()", "The row sizes; rows past the given ones repeat the last size."),
    createNamedParam("gutter", TRACKS, "()", "The gaps between rows and between columns."),
    createNamedParam("column-gutter", TRACKS, "()", "The gaps between columns."),
    createNamedParam("row-gutter", TRACKS, "()", "The gaps between rows."),
    ...styling(kind),
  ], "content", [
    createFunctionBuiltin("cell", `A cell of the ${kind.name}, used to override its position, span or styling.`, [
      createPositionalParam("body", "content", "The cell's content."),
      createNamedParam("x", "auto | int", "auto", "The cell's column, counting from zero."),
      createNamedParam("y", "auto | int", "auto", "The cell's row, counting from zero."),
      createNamedParam("colspan", "int", "1", "The number of columns the cell spans."),
      createNamedParam("rowspan", "int", "1", "The number of rows the cell spans."),
      ...CELL_STYLING,
      createNamedParam("breakable", "auto | bool", "auto", "Whether rows spanned by the cell may break across pages."),
    ], "content"),
    createFunctionBuiltin("header", `The header rows of the ${kind.name}, repeated on every page.`, [
      children("The header's cells."),
      createNamedParam("repeat", "bool", "true", "Whether the header repeats across pages."),
      createNamedParam("level", "int", "1", "The header's nesting level; a header replaces repeating headers of the same or a deeper level."),
    ], "content"),
    createFunctionBuiltin("footer", `The footer rows of the ${kind.name}, repeated on every page.`, [
      children("The footer's cells."),
      createNamedParam("repeat", "bool", "true", "Whether the footer repeats across pages."),
    ], "content"),
    line(kind, "y"),
    line(kind, "x"),
  ])];
}
