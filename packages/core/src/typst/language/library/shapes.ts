// Catalogues Typst's drawn shapes and images: rectangles, circles, lines, polygons, curves and raster or vector images.
import { fn, named, pos, variadic, type TypstBuiltin, type TypstParam } from "./typstBuiltin";

const PAINT = "none | color | gradient | tiling";
const STROKE = "none | auto | length | color | gradient | stroke | tiling | dictionary";
const WIDTH = named("width", "auto | relative", "auto", "The shape's width.");
const HEIGHT = named("height", "auto | relative | fraction", "auto", "The shape's height.");
const BODY = pos("body", "none | content", "Content placed inside the shape.", "none");
const FILL = named("fill", PAINT, "none", "How to fill the shape.");
const SHAPE_STROKE = named("stroke", STROKE, "auto", "How to stroke the outline; `auto` uses a 1pt black stroke when there is no fill.");
const RADIUS = named("radius", "relative | dictionary", "(:)", "How much to round the corners, for all corners or per corner.");
const INSET = named("inset", "relative | dictionary", "0% + 5pt", "How much to pad the content inside the shape.");
const OUTSET = named("outset", "relative | dictionary", "(:)", "How much to expand the shape beyond its layout size.");
const FILL_RULE = named("fill-rule", "str", "\"non-zero\"", "The rule that decides which areas are inside: `\"non-zero\"` or `\"even-odd\"`.");
const RELATIVE = named("relative", "bool", "false", "Whether the coordinates are relative to the previous point.");

const segment = (name: string, doc: string, params: readonly TypstParam[]): TypstBuiltin =>
  fn(name, doc, [...params, RELATIVE], "content");

const CURVE_MEMBERS: readonly TypstBuiltin[] = [
  segment("move", "Starts a new curve component at a point.", [pos("start", "array", "The starting point.")]),
  segment("line", "Adds a straight segment to a point.", [pos("end", "array", "The end point.")]),
  segment("quad", "Adds a quadratic Bézier segment.", [
    pos("control", "none | auto | array", "The control point; `auto` mirrors the previous one, `none` makes a line."),
    pos("end", "array", "The end point."),
  ]),
  segment("cubic", "Adds a cubic Bézier segment.", [
    pos("control-start", "none | auto | array", "The first control point; `auto` mirrors the previous one."),
    pos("control-end", "none | array", "The second control point."),
    pos("end", "array", "The end point."),
  ]),
  fn("close", "Closes the current curve component back to its start.", [
    named("mode", "str", "\"smooth\"", "How to close: `\"smooth\"` with a curve or `\"straight\"` with a line."),
  ], "content"),
];

export const SHAPES: readonly TypstBuiltin[] = [
  fn("image", "A raster or vector graphic loaded from a file or from bytes.", [
    pos("source", "str | bytes", "A path to the image file, or its raw bytes."),
    named("format", "auto | str | dictionary", "auto", "The image format, such as `\"png\"` or `\"svg\"`; `auto` detects it."),
    WIDTH, HEIGHT,
    named("alt", "none | str", "none", "A text description of the image for assistive technology."),
    named("page", "int", "1", "Which page of a multi-page PDF image to show."),
    named("fit", "str", "\"cover\"", "How the image fills its frame: `\"cover\"`, `\"contain\"` or `\"stretch\"`."),
    named("scaling", "auto | str", "auto", "How a raster image is scaled: `\"smooth\"` or `\"pixelated\"`."),
    named("icc", "auto | str | bytes", "auto", "An ICC colour profile for the image."),
  ], "content"),
  fn("rect", "A rectangle, optionally with content inside.", [BODY, WIDTH, HEIGHT, FILL, SHAPE_STROKE, RADIUS, INSET, OUTSET], "content"),
  fn("square", "A square, optionally with content inside.", [
    BODY, named("size", "auto | length", "auto", "The square's side length; sets both width and height."),
    WIDTH, HEIGHT, FILL, SHAPE_STROKE, RADIUS, INSET, OUTSET,
  ], "content"),
  fn("ellipse", "An ellipse, optionally with content inside.", [BODY, WIDTH, HEIGHT, FILL, SHAPE_STROKE, INSET, OUTSET], "content"),
  fn("circle", "A circle, optionally with content inside.", [
    BODY, named("radius", "length", "0pt", "The circle's radius; exclusive with `width` and `height`."),
    WIDTH, HEIGHT, FILL, SHAPE_STROKE, INSET, OUTSET,
  ], "content"),
  fn("line", "A straight line from a start point, given by an end point or by a length and angle.", [
    named("start", "array", "(0% + 0pt, 0% + 0pt)", "The start point."),
    named("end", "none | array", "none", "The end point; when `none`, `length` and `angle` set it."),
    named("length", "relative", "0% + 30pt", "The line's length, used when `end` is `none`."),
    named("angle", "angle", "0deg", "The line's angle, used when `end` is `none`."),
    named("stroke", "length | color | gradient | stroke | tiling | dictionary", "1pt + black", "How to stroke the line."),
  ], "content"),
  fn("polygon", "A closed polygon through a list of vertices.", [
    variadic("vertices", "array", "The vertices, each an `(x, y)` array."),
    FILL, FILL_RULE, SHAPE_STROKE,
  ], "content", [
    fn("regular", "A regular polygon such as an equilateral triangle or a hexagon.", [
      FILL, SHAPE_STROKE,
      named("size", "length", "1em", "The diameter of the polygon's circumscribed circle."),
      named("vertices", "int", "3", "The number of vertices."),
    ], "content"),
  ]),
  fn("curve", "A curve made of move, line, Bézier and close components.", [
    variadic("components", "content", "The curve components, such as `curve.move(..)` and `curve.line(..)`."),
    FILL, FILL_RULE, SHAPE_STROKE,
  ], "content", CURVE_MEMBERS),
  fn("path", "A path through vertices with optional Bézier control points; deprecated in favour of `curve`.", [
    variadic("vertices", "array", "The vertices, each a point or a point with control points."),
    FILL, FILL_RULE, SHAPE_STROKE,
    named("closed", "bool", "false", "Whether to close the path back to its first vertex."),
  ], "content"),
];
