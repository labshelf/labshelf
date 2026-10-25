// Catalogues Typst's drawn shapes and images: rectangles, circles, lines, polygons, curves and raster or vector images.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, createVariadicParam, type TypstBuiltin, type TypstParam } from "./typstBuiltin";

const PAINT = "none | color | gradient | tiling";
const STROKE = "none | auto | length | color | gradient | stroke | tiling | dictionary";
const WIDTH = createNamedParam("width", "auto | relative", "auto", "The shape's width.");
const HEIGHT = createNamedParam("height", "auto | relative | fraction", "auto", "The shape's height.");
const BODY = createPositionalParam("body", "none | content", "Content placed inside the shape.", "none");
const FILL = createNamedParam("fill", PAINT, "none", "How to fill the shape.");
const SHAPE_STROKE = createNamedParam("stroke", STROKE, "auto", "How to stroke the outline; `auto` uses a 1pt black stroke when there is no fill.");
const RADIUS = createNamedParam("radius", "relative | dictionary", "(:)", "How much to round the corners, for all corners or per corner.");
const INSET = createNamedParam("inset", "relative | dictionary", "0% + 5pt", "How much to pad the content inside the shape.");
const OUTSET = createNamedParam("outset", "relative | dictionary", "(:)", "How much to expand the shape beyond its layout size.");
const FILL_RULE = createNamedParam("fill-rule", "str", "\"non-zero\"", "The rule that decides which areas are inside: `\"non-zero\"` or `\"even-odd\"`.");
const RELATIVE = createNamedParam("relative", "bool", "false", "Whether the coordinates are relative to the previous point.");

const segment = (name: string, doc: string, params: readonly TypstParam[]): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [...params, RELATIVE], "content");

const CURVE_MEMBERS: readonly TypstBuiltin[] = [
  segment("move", "Starts a new curve component at a point.", [createPositionalParam("start", "array", "The starting point.")]),
  segment("line", "Adds a straight segment to a point.", [createPositionalParam("end", "array", "The end point.")]),
  segment("quad", "Adds a quadratic Bézier segment.", [
    createPositionalParam("control", "none | auto | array", "The control point; `auto` mirrors the previous one, `none` makes a line."),
    createPositionalParam("end", "array", "The end point."),
  ]),
  segment("cubic", "Adds a cubic Bézier segment.", [
    createPositionalParam("control-start", "none | auto | array", "The first control point; `auto` mirrors the previous one."),
    createPositionalParam("control-end", "none | array", "The second control point."),
    createPositionalParam("end", "array", "The end point."),
  ]),
  createFunctionBuiltin("close", "Closes the current curve component back to its start.", [
    createNamedParam("mode", "str", "\"smooth\"", "How to close: `\"smooth\"` with a curve or `\"straight\"` with a line."),
  ], "content"),
];

export const SHAPES: readonly TypstBuiltin[] = [
  createFunctionBuiltin("image", "A raster or vector graphic loaded from a file or from bytes.", [
    createPositionalParam("source", "str | bytes", "A path to the image file, or its raw bytes."),
    createNamedParam("format", "auto | str | dictionary", "auto", "The image format, such as `\"png\"` or `\"svg\"`; `auto` detects it."),
    WIDTH, HEIGHT,
    createNamedParam("alt", "none | str", "none", "A text description of the image for assistive technology."),
    createNamedParam("page", "int", "1", "Which page of a multi-page PDF image to show."),
    createNamedParam("fit", "str", "\"cover\"", "How the image fills its frame: `\"cover\"`, `\"contain\"` or `\"stretch\"`."),
    createNamedParam("scaling", "auto | str", "auto", "How a raster image is scaled: `\"smooth\"` or `\"pixelated\"`."),
    createNamedParam("icc", "auto | str | bytes", "auto", "An ICC colour profile for the image."),
  ], "content"),
  createFunctionBuiltin("rect", "A rectangle, optionally with content inside.", [BODY, WIDTH, HEIGHT, FILL, SHAPE_STROKE, RADIUS, INSET, OUTSET], "content"),
  createFunctionBuiltin("square", "A square, optionally with content inside.", [
    BODY, createNamedParam("size", "auto | length", "auto", "The square's side length; sets both width and height."),
    WIDTH, HEIGHT, FILL, SHAPE_STROKE, RADIUS, INSET, OUTSET,
  ], "content"),
  createFunctionBuiltin("ellipse", "An ellipse, optionally with content inside.", [BODY, WIDTH, HEIGHT, FILL, SHAPE_STROKE, INSET, OUTSET], "content"),
  createFunctionBuiltin("circle", "A circle, optionally with content inside.", [
    BODY, createNamedParam("radius", "length", "0pt", "The circle's radius; exclusive with `width` and `height`."),
    WIDTH, HEIGHT, FILL, SHAPE_STROKE, INSET, OUTSET,
  ], "content"),
  createFunctionBuiltin("line", "A straight line from a start point, given by an end point or by a length and angle.", [
    createNamedParam("start", "array", "(0% + 0pt, 0% + 0pt)", "The start point."),
    createNamedParam("end", "none | array", "none", "The end point; when `none`, `length` and `angle` set it."),
    createNamedParam("length", "relative", "0% + 30pt", "The line's length, used when `end` is `none`."),
    createNamedParam("angle", "angle", "0deg", "The line's angle, used when `end` is `none`."),
    createNamedParam("stroke", "length | color | gradient | stroke | tiling | dictionary", "1pt + black", "How to stroke the line."),
  ], "content"),
  createFunctionBuiltin("polygon", "A closed polygon through a list of vertices.", [
    createVariadicParam("vertices", "array", "The vertices, each an `(x, y)` array."),
    FILL, FILL_RULE, SHAPE_STROKE,
  ], "content", [
    createFunctionBuiltin("regular", "A regular polygon such as an equilateral triangle or a hexagon.", [
      FILL, SHAPE_STROKE,
      createNamedParam("size", "length", "1em", "The diameter of the polygon's circumscribed circle."),
      createNamedParam("vertices", "int", "3", "The number of vertices."),
    ], "content"),
  ]),
  createFunctionBuiltin("curve", "A curve made of move, line, Bézier and close components.", [
    createVariadicParam("components", "content", "The curve components, such as `curve.move(..)` and `curve.line(..)`."),
    FILL, FILL_RULE, SHAPE_STROKE,
  ], "content", CURVE_MEMBERS),
  createFunctionBuiltin("path", "A path through vertices with optional Bézier control points; deprecated in favour of `curve`.", [
    createVariadicParam("vertices", "array", "The vertices, each a point or a point with control points."),
    FILL, FILL_RULE, SHAPE_STROKE,
    createNamedParam("closed", "bool", "false", "Whether to close the path back to its first vertex."),
  ], "content"),
];
