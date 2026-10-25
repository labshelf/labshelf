// Catalogues Typst's page-level layout: pages, page and column breaks, columns, spacing and placement.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, type TypstBuiltin } from "../typstBuiltin";

const spacing = (name: "h" | "v", doc: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [
    createPositionalParam("amount", "relative | fraction", "How much space to insert; a fraction shares the remaining space."),
    createNamedParam("weak", "bool", "false", "Whether the spacing collapses at the start or end of a " + (name === "h" ? "line" : "flow") + " and next to other weak spacing."),
  ], "content");

export const PAGES: readonly TypstBuiltin[] = [
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
