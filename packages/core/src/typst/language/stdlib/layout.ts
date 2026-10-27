// Catalogues Typst's layout category: pages, boxes, grids and tables, lengths and alignment values.
import { createFunctionBuiltin, createMethodBuiltin, createNamedParam, createPositionalParam, createTypeBuiltin, createConstantBuiltin, type TypstBuiltin, type TypstParam } from "./typstBuiltin";

// Catalogues Typst's page-level layout: pages, page and column breaks, columns, spacing and placement.
const spacing = (name: "h" | "v", doc: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [
    createPositionalParam("amount", "relative | fraction", "How much space to insert; a fraction shares the remaining space."),
    createNamedParam("weak", "bool", "false", "Whether the spacing collapses at the start or end of a " + (name === "h" ? "line" : "flow") + " and next to other weak spacing."),
  ], "content");

const PAGES: readonly TypstBuiltin[] = [
  createFunctionBuiltin("page", "Lays out its content on one or more pages; usually configured with `#set page(..)`.", [
    createPositionalParam("body", "content", "The contents of the page or pages."),
    createNamedParam("paper", "str", "\"a4\"", "A standard paper size that sets width and height, such as `\"us-letter\"`."),
    createNamedParam("width", "auto | length", "595.28pt", "The page's width; `auto` sizes the page to its content."),
    createNamedParam("height", "auto | length", "841.89pt", "The page's height; `auto` sizes the page to its content."),
    createNamedParam("flipped", "bool", "false", "Whether to swap width and height for landscape pages."),
    createNamedParam("margin", "auto | relative | dictionary", "auto", "The page margins, one for all sides or a dictionary by side; `auto` derives them from the page size."),
    createNamedParam("binding", "auto | alignment", "auto", "On which side the pages are bound: `left` or `right`; it decides which margin is inside."),
    createNamedParam("columns", "int", "1", "How many columns the page has."),
    createNamedParam("fill", "none | auto | color | gradient | tiling", "auto", "The page's background fill; `auto` is white in PDF and transparent in other formats."),
    createNamedParam("numbering", "none | str | function", "none", "How to number pages, such as `\"1\"` or `\"1 / 1\"`."),
    createNamedParam("number-align", "alignment", "center + bottom", "Where to place the page number."),
    createNamedParam("header", "none | auto | content", "auto", "The page's header, placed in the top margin."),
    createNamedParam("header-ascent", "relative", "30% + 0pt", "The space between the header and the body."),
    createNamedParam("footer", "none | auto | content", "auto", "The page's footer, placed in the bottom margin; `auto` shows the page number if there is one."),
    createNamedParam("footer-descent", "relative", "30% + 0pt", "The space between the footer and the body."),
    createNamedParam("background", "none | content", "none", "Content placed behind the page's body."),
    createNamedParam("foreground", "none | content", "none", "Content placed in front of the page's body."),
  ], "content"),
  createFunctionBuiltin("pagebreak", "Starts a new page.", [
    createNamedParam("weak", "bool", "false", "Whether to skip the break if the page is already empty."),
    createNamedParam("to", "none | str", "none", "Whether to continue on an `\"even\"` or `\"odd\"` page, inserting an empty one if needed."),
  ], "content"),
  createFunctionBuiltin("colbreak", "Starts a new column, or a new page after the last column.", [
    createNamedParam("weak", "bool", "false", "Whether to skip the break if the column is already empty."),
  ], "content"),
  createFunctionBuiltin("columns", "Splits content into multiple columns of equal width.", [
    createPositionalParam("count", "int", "The number of columns.", "2"),
    createPositionalParam("body", "content", "The content to split into columns."),
    createNamedParam("gutter", "relative", "4% + 0pt", "The space between columns."),
  ], "content"),
  spacing("h", "Inserts horizontal spacing into a paragraph."),
  spacing("v", "Inserts vertical spacing between blocks."),
  createFunctionBuiltin("align", "Aligns content horizontally and vertically.", [
    createPositionalParam("alignment", "alignment", "The alignment along both axes, such as `center + horizon`.", "start + top"),
    createPositionalParam("body", "content", "The content to align."),
  ], "content"),
  createFunctionBuiltin("place", "Places content relative to its parent container, without affecting the layout of other content, or floats it to the top or bottom.", [
    createPositionalParam("alignment", "auto | alignment", "Where to place the content relative to the parent; `auto` for floats picks top or bottom.", "start"),
    createPositionalParam("body", "content", "The content to place."),
    createNamedParam("scope", "str", "\"column\"", "Relative to which container the content is placed: `\"column\"` or `\"parent\"`."),
    createNamedParam("float", "bool", "false", "Whether the content floats to the top or bottom, pushing other content aside."),
    createNamedParam("clearance", "length", "1.5em", "The spacing between a float and the content around it."),
    createNamedParam("dx", "relative", "0% + 0pt", "The horizontal offset from the aligned position."),
    createNamedParam("dy", "relative", "0% + 0pt", "The vertical offset from the aligned position."),
  ], "content", [
    createFunctionBuiltin("flush", "Places all pending floats before continuing.", [], "content"),
  ]),
  createFunctionBuiltin("repeat", "Repeats content to fill the available space, as in dot leaders.", [
    createPositionalParam("body", "content", "The content to repeat."),
    createNamedParam("gap", "length", "0pt", "The gap between repetitions."),
    createNamedParam("justify", "bool", "true", "Whether to stretch the gaps to fill the space exactly."),
  ], "content"),
  createFunctionBuiltin("hide", "Hides content without affecting the layout.", [
    createPositionalParam("body", "content", "The content to hide."),
  ], "content"),
  createFunctionBuiltin("measure", "Measures the size content would take when laid out; needs `context`.", [
    createPositionalParam("content", "content", "The content to measure."),
    createNamedParam("width", "auto | length", "auto", "The width available to the content; `auto` means unbounded."),
    createNamedParam("height", "auto | length", "auto", "The height available to the content; `auto` means unbounded."),
  ], "dictionary"),
  createFunctionBuiltin("layout", "Gives access to the size of the current outer container, passed as a `(width, height)` dictionary to a function.", [
    createPositionalParam("func", "function", "A function that receives the container's size and returns content."),
  ], "content"),
];

// Catalogues Typst's containers and transforms: box, block, stack, pad, move, rotate, scale and skew.
const STROKE = "none | length | color | gradient | stroke | tiling | dictionary";

const decoration: readonly TypstParam[] = [
  createNamedParam("fill", "none | color | gradient | tiling", "none", "The background fill."),
  createNamedParam("stroke", STROKE, "(:)", "The border stroke, one for all sides or a dictionary by side."),
  createNamedParam("radius", "relative | dictionary", "(:)", "How much to round the corners."),
  createNamedParam("inset", "relative | dictionary", "(:)", "How much to pad the content."),
  createNamedParam("outset", "relative | dictionary", "(:)", "How much to expand the background beyond the size, without affecting layout."),
  createNamedParam("clip", "bool", "false", "Whether to clip content that overflows the container."),
];

const transform: readonly TypstParam[] = [
  createNamedParam("origin", "alignment", "center + horizon", "The point the transformation is relative to."),
  createNamedParam("reflow", "bool", "false", "Whether the transformation affects the layout around the content."),
];

const offset = (axis: "x" | "y") => createNamedParam(`d${axis}`, "relative", "0% + 0pt", `The ${axis === "x" ? "horizontal" : "vertical"} displacement.`);

const BOXES: readonly TypstBuiltin[] = [
  createFunctionBuiltin("box", "An inline container that sizes and decorates content within a paragraph.", [
    createPositionalParam("body", "none | content", "The content in the box.", "none"),
    createNamedParam("width", "auto | relative | fraction", "auto", "The box's width."),
    createNamedParam("height", "auto | relative", "auto", "The box's height."),
    createNamedParam("baseline", "relative", "0% + 0pt", "How far to shift the box's baseline."),
    ...decoration,
  ], "content"),
  createFunctionBuiltin("block", "A block-level container that separates content and can be sized and decorated.", [
    createPositionalParam("body", "none | content", "The content in the block.", "none"),
    createNamedParam("width", "auto | relative", "auto", "The block's width."),
    createNamedParam("height", "auto | relative | fraction", "auto", "The block's height."),
    createNamedParam("breakable", "bool", "true", "Whether the block can break across pages."),
    ...decoration,
    createNamedParam("spacing", "relative | fraction", "1.2em", "The spacing around the block; shorthand for `above` and `below`."),
    createNamedParam("above", "auto | relative | fraction", "auto", "The spacing between the block and its predecessor."),
    createNamedParam("below", "auto | relative | fraction", "auto", "The spacing between the block and its successor."),
    createNamedParam("sticky", "bool", "false", "Whether the block stays on the same page as the next block."),
  ], "content"),
  createFunctionBuiltin("stack", "Arranges content and spacing along an axis.", [
    createPositionalParam("children", "relative | fraction | content", "The items to stack, as any number of arguments."),
    createNamedParam("dir", "direction", "ttb", "The direction to stack in."),
    createNamedParam("spacing", "none | relative | fraction", "none", "The spacing inserted between items."),
  ], "content"),
  createFunctionBuiltin("pad", "Adds spacing around content.", [
    createPositionalParam("body", "content", "The content to pad."),
    ...["left", "top", "right", "bottom"].map((side) => createNamedParam(side, "relative", "0% + 0pt", `The padding on the ${side}.`)),
    createNamedParam("x", "relative", "0% + 0pt", "The horizontal padding, on both sides."),
    createNamedParam("y", "relative", "0% + 0pt", "The vertical padding, on both sides."),
    createNamedParam("rest", "relative", "0% + 0pt", "The padding on all sides not otherwise given."),
  ], "content"),
  createFunctionBuiltin("move", "Moves content without affecting the layout.", [
    createPositionalParam("body", "content", "The content to move."),
    offset("x"),
    offset("y"),
  ], "content"),
  createFunctionBuiltin("rotate", "Rotates content.", [
    createPositionalParam("angle", "angle", "The amount of rotation, clockwise.", "0deg"),
    createPositionalParam("body", "content", "The content to rotate."),
    ...transform,
  ], "content"),
  createFunctionBuiltin("scale", "Scales content.", [
    createPositionalParam("factor", "auto | length | ratio", "The scaling factor for both axes.", "100%"),
    createPositionalParam("body", "content", "The content to scale."),
    createNamedParam("x", "auto | length | ratio", "100%", "The horizontal scaling factor, or the target width."),
    createNamedParam("y", "auto | length | ratio", "100%", "The vertical scaling factor, or the target height."),
    ...transform,
  ], "content"),
  createFunctionBuiltin("skew", "Skews content.", [
    createPositionalParam("body", "content", "The content to skew."),
    createNamedParam("ax", "angle", "0deg", "The horizontal skewing angle."),
    createNamedParam("ay", "angle", "0deg", "The vertical skewing angle."),
    ...transform,
  ], "content"),
];

// Catalogues Typst's layout value types (length, alignment, direction, angle, ratio, fraction, relative) and their named values.
const unit = (name: string, unitName: string) => createMethodBuiltin(name, `Converts an absolute length to a number of ${unitName}.`, "float");

const ALIGNMENTS: readonly [string, string][] = [
  ["start", "Aligns at the start of the text direction."], ["end", "Aligns at the end of the text direction."],
  ["left", "Aligns at the left."], ["center", "Aligns at the horizontal centre."], ["right", "Aligns at the right."],
  ["top", "Aligns at the top."], ["horizon", "Aligns at the vertical middle."], ["bottom", "Aligns at the bottom."],
];
const DIRECTIONS: readonly [string, string][] = [
  ["ltr", "The left-to-right direction."], ["rtl", "The right-to-left direction."],
  ["ttb", "The top-to-bottom direction."], ["btt", "The bottom-to-top direction."],
];

const VALUES: readonly TypstBuiltin[] = [
  createTypeBuiltin("length", "A size or distance, absolute (`1pt`, `2mm`, `3cm`, `4in`) or relative to the font size (`1em`).", undefined, [
    unit("pt", "points"), unit("mm", "millimeters"), unit("cm", "centimeters"), unit("inches", "inches"),
    createMethodBuiltin("to-absolute", "Resolves the length to an absolute one, using the current font size; needs `context`.", "length"),
  ]),
  createTypeBuiltin("alignment", "Where to align something along the horizontal and vertical axes; combine them with `+`.", undefined, [
    createMethodBuiltin("axis", "The axis of the alignment, `\"horizontal\"` or `\"vertical\"`, or `none` for a 2D alignment.", "none | str"),
    createMethodBuiltin("inv", "The inverse alignment, such as `right` for `left`.", "alignment"),
  ]),
  createTypeBuiltin("direction", "The four directions in which content can be laid out.", undefined, [
    createMethodBuiltin("axis", "The axis of the direction, `\"horizontal\"` or `\"vertical\"`.", "str"),
    createMethodBuiltin("start", "The alignment at which the direction starts.", "alignment"),
    createMethodBuiltin("end", "The alignment at which the direction ends.", "alignment"),
    createMethodBuiltin("inv", "The opposite direction.", "direction"),
  ]),
  createTypeBuiltin("angle", "An angle, in degrees (`90deg`) or radians (`1rad`).", undefined, [
    createMethodBuiltin("rad", "Converts the angle to a number of radians.", "float"),
    createMethodBuiltin("deg", "Converts the angle to a number of degrees.", "float"),
  ]),
  createTypeBuiltin("ratio", "A part of a whole, written as a percentage such as `50%`.", undefined, []),
  createTypeBuiltin("fraction", "A part of the remaining space, written as `1fr`; spaces are shared in proportion to their fractions.", undefined, []),
  createTypeBuiltin("relative", "A length plus a ratio of the container's size, such as `50% + 1cm`.", undefined, []),
  ...ALIGNMENTS.map(([name, doc]) => createConstantBuiltin(name, doc)),
  ...DIRECTIONS.map(([name, doc]) => createConstantBuiltin(name, doc)),
];

// Builds the catalogue entries of `grid` and `table`, which share their parameters and cell, header and line members.
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

export const LAYOUT: readonly TypstBuiltin[] = [
  ...PAGES,
  ...BOXES,
  ...createCellGrid({ name: "grid", inset: "(:)", stroke: "(:)" }, "Arranges content in a grid of rows and columns, with optional gutters, fills and strokes."),
  ...VALUES,
];
