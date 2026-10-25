// Catalogues Typst's page-level layout: pages, page and column breaks, columns, spacing and placement.
import { fn, named, pos, type TypstBuiltin } from "../typstBuiltin";

const spacing = (name: "h" | "v", doc: string): TypstBuiltin =>
  fn(name, doc, [
    pos("amount", "relative | fraction", "How much space to insert; a fraction shares the remaining space."),
    named("weak", "bool", "false", "Whether the spacing collapses at the start or end of a " + (name === "h" ? "line" : "flow") + " and next to other weak spacing."),
  ], "content");

export const PAGES: readonly TypstBuiltin[] = [
  fn("page", "Lays out its content on one or more pages; usually configured with `#set page(..)`.", [
    pos("body", "content", "The contents of the page or pages."),
    named("paper", "str", "\"a4\"", "A standard paper size that sets width and height, such as `\"us-letter\"`."),
    named("width", "auto | length", "595.28pt", "The page's width; `auto` sizes the page to its content."),
    named("height", "auto | length", "841.89pt", "The page's height; `auto` sizes the page to its content."),
    named("flipped", "bool", "false", "Whether to swap width and height for landscape pages."),
    named("margin", "auto | relative | dictionary", "auto", "The page margins, one for all sides or a dictionary by side; `auto` derives them from the page size."),
    named("binding", "auto | alignment", "auto", "On which side the pages are bound: `left` or `right`; it decides which margin is inside."),
    named("columns", "int", "1", "How many columns the page has."),
    named("fill", "none | auto | color | gradient | tiling", "auto", "The page's background fill; `auto` is white in PDF and transparent in other formats."),
    named("numbering", "none | str | function", "none", "How to number pages, such as `\"1\"` or `\"1 / 1\"`."),
    named("number-align", "alignment", "center + bottom", "Where to place the page number."),
    named("header", "none | auto | content", "auto", "The page's header, placed in the top margin."),
    named("header-ascent", "relative", "30% + 0pt", "The space between the header and the body."),
    named("footer", "none | auto | content", "auto", "The page's footer, placed in the bottom margin; `auto` shows the page number if there is one."),
    named("footer-descent", "relative", "30% + 0pt", "The space between the footer and the body."),
    named("background", "none | content", "none", "Content placed behind the page's body."),
    named("foreground", "none | content", "none", "Content placed in front of the page's body."),
  ], "content"),
  fn("pagebreak", "Starts a new page.", [
    named("weak", "bool", "false", "Whether to skip the break if the page is already empty."),
    named("to", "none | str", "none", "Whether to continue on an `\"even\"` or `\"odd\"` page, inserting an empty one if needed."),
  ], "content"),
  fn("colbreak", "Starts a new column, or a new page after the last column.", [
    named("weak", "bool", "false", "Whether to skip the break if the column is already empty."),
  ], "content"),
  fn("columns", "Splits content into multiple columns of equal width.", [
    pos("count", "int", "The number of columns.", "2"),
    pos("body", "content", "The content to split into columns."),
    named("gutter", "relative", "4% + 0pt", "The space between columns."),
  ], "content"),
  spacing("h", "Inserts horizontal spacing into a paragraph."),
  spacing("v", "Inserts vertical spacing between blocks."),
  fn("align", "Aligns content horizontally and vertically.", [
    pos("alignment", "alignment", "The alignment along both axes, such as `center + horizon`.", "start + top"),
    pos("body", "content", "The content to align."),
  ], "content"),
  fn("place", "Places content relative to its parent container, without affecting the layout of other content, or floats it to the top or bottom.", [
    pos("alignment", "auto | alignment", "Where to place the content relative to the parent; `auto` for floats picks top or bottom.", "start"),
    pos("body", "content", "The content to place."),
    named("scope", "str", "\"column\"", "Relative to which container the content is placed: `\"column\"` or `\"parent\"`."),
    named("float", "bool", "false", "Whether the content floats to the top or bottom, pushing other content aside."),
    named("clearance", "length", "1.5em", "The spacing between a float and the content around it."),
    named("dx", "relative", "0% + 0pt", "The horizontal offset from the aligned position."),
    named("dy", "relative", "0% + 0pt", "The vertical offset from the aligned position."),
  ], "content", [
    fn("flush", "Places all pending floats before continuing.", [], "content"),
  ]),
  fn("repeat", "Repeats content to fill the available space, as in dot leaders.", [
    pos("body", "content", "The content to repeat."),
    named("gap", "length", "0pt", "The gap between repetitions."),
    named("justify", "bool", "true", "Whether to stretch the gaps to fill the space exactly."),
  ], "content"),
  fn("hide", "Hides content without affecting the layout.", [
    pos("body", "content", "The content to hide."),
  ], "content"),
  fn("measure", "Measures the size content would take when laid out; needs `context`.", [
    pos("content", "content", "The content to measure."),
    named("width", "auto | length", "auto", "The width available to the content; `auto` means unbounded."),
    named("height", "auto | length", "auto", "The height available to the content; `auto` means unbounded."),
  ], "dictionary"),
  fn("layout", "Gives access to the size of the current outer container, passed as a `(width, height)` dictionary to a function.", [
    pos("func", "function", "A function that receives the container's size and returns content."),
  ], "content"),
];
