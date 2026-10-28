// Typst's visualize category: shapes and curves, then colours, gradients, tilings and strokes.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, createTypeBuiltin, createConstantBuiltin, createVariadicParam, type TypstBuiltin, type TypstParam } from "./typstBuiltin";

// Catalogues Typst's drawn shapes and images: rectangles, circles, lines, polygons, curves and raster or vector images.
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

// Catalogues Typst's paints and strokes: colours with their spaces, gradients, tilings and stroke specs.
const SPACE = createNamedParam("space", "any", "oklab", "The colour space to interpolate in, such as `oklab` or `rgb`.");
const PAINT_RELATIVE = createNamedParam("relative", "auto | str", "auto", "What the paint is relative to: `\"self\"` or `\"parent\"`; `auto` picks per element.");
const STOPS = createVariadicParam("stops", "color | array", "The colour stops, each a colour or a `(color, ratio)` pair.");
const CENTER = createNamedParam("center", "array", "(50%, 50%)", "The centre of the gradient.");

const constructor = (name: string, doc: string, components: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createVariadicParam("components", "int | float | ratio | angle | color", components)], "color");

const factor = (name: string, doc: string, param: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam(param, "ratio", "How strongly to apply the change.")], "color");

const LUMA = constructor("luma", "A grayscale colour.", "The lightness as an int from 0 to 255 or a ratio, and an optional alpha; or a colour to convert.");
const OKLAB = constructor("oklab", "A colour in the perceptual Oklab space.", "The lightness, a and b components and an optional alpha; or a colour to convert.");
const OKLCH = constructor("oklch", "A colour in the perceptual Oklch space.", "The lightness, chroma, hue angle and an optional alpha; or a colour to convert.");
const RGB = constructor("rgb", "An sRGB colour, from components or a hex string such as `\"#239dad\"`.", "The red, green and blue components and an optional alpha, a hex string, or a colour to convert.");
const CMYK = constructor("cmyk", "A colour in the CMYK space, for print.", "The cyan, magenta, yellow and key ratios; or a colour to convert.");

const COLOR_MEMBERS: readonly TypstBuiltin[] = [
  LUMA, OKLAB, OKLCH, RGB, CMYK,
  constructor("linear-rgb", "A colour in the linear RGB space.", "The red, green and blue components and an optional alpha; or a colour to convert."),
  constructor("hsl", "A colour in the HSL space.", "The hue angle, saturation, lightness and an optional alpha; or a colour to convert."),
  constructor("hsv", "A colour in the HSV space.", "The hue angle, saturation, value and an optional alpha; or a colour to convert."),
  createFunctionBuiltin("mix", "Mixes colours together, optionally weighted.", [
    createVariadicParam("colors", "color | array", "The colours, each a colour or a `(color, weight)` pair."), SPACE,
  ], "color"),
  createFunctionBuiltin("components", "The colour's components in its own space.", [
    createNamedParam("alpha", "bool", "true", "Whether to include the alpha component."),
  ], "array"),
  createFunctionBuiltin("space", "The colour space the colour is stored in.", [], "any"),
  createFunctionBuiltin("to-hex", "The colour as an sRGB hex string.", [], "str"),
  factor("lighten", "Lightens the colour by a factor.", "factor"),
  factor("darken", "Darkens the colour by a factor.", "factor"),
  factor("saturate", "Increases the colour's saturation by a factor.", "factor"),
  factor("desaturate", "Decreases the colour's saturation by a factor.", "factor"),
  factor("transparentize", "Makes the colour more transparent by a factor.", "scale"),
  factor("opacify", "Makes the colour more opaque by a factor.", "scale"),
  createFunctionBuiltin("negate", "The colour's complement.", [SPACE], "color"),
  createFunctionBuiltin("rotate", "Rotates the colour's hue by an angle.", [
    createPositionalParam("angle", "angle", "The angle to rotate the hue by."),
    createNamedParam("space", "any", "oklch", "The colour space whose hue is rotated."),
  ], "color"),
];

const GRADIENT_MEMBERS: readonly TypstBuiltin[] = [
  createFunctionBuiltin("linear", "A gradient that changes colour along a straight line.", [
    STOPS, SPACE, PAINT_RELATIVE,
    createNamedParam("dir", "direction", "ltr", "The direction of the gradient."),
  ], "gradient"),
  createFunctionBuiltin("radial", "A gradient that changes colour outward from a centre.", [
    STOPS, SPACE, PAINT_RELATIVE, CENTER,
    createNamedParam("radius", "ratio", "50%", "The radius of the end circle."),
    createNamedParam("focal-center", "auto | array", "auto", "The centre of the start circle; `auto` uses `center`."),
    createNamedParam("focal-radius", "ratio", "0%", "The radius of the start circle."),
  ], "gradient"),
  createFunctionBuiltin("conic", "A gradient that changes colour around a centre.", [
    STOPS,
    createNamedParam("angle", "angle", "0deg", "The angle at which the gradient starts."),
    SPACE, PAINT_RELATIVE, CENTER,
  ], "gradient"),
  createFunctionBuiltin("sample", "The colour at a position along the gradient.", [createPositionalParam("t", "angle | ratio", "The position to sample.")], "color"),
  createFunctionBuiltin("sharp", "Turns the gradient into one with hard steps.", [
    createPositionalParam("steps", "int", "The number of steps."),
    createNamedParam("smoothness", "ratio", "0%", "How much to blur the step edges."),
  ], "gradient"),
  createFunctionBuiltin("repeat", "Repeats the gradient a number of times.", [
    createPositionalParam("repetitions", "int", "How often to repeat."),
    createNamedParam("mirror", "bool", "false", "Whether every second repetition is reversed."),
  ], "gradient"),
  createFunctionBuiltin("stops", "The gradient's colour stops.", [], "array"),
  createFunctionBuiltin("kind", "The gradient's constructor: `gradient.linear`, `gradient.radial` or `gradient.conic`.", [], "function"),
];

const NAMED_COLORS: readonly [string, string][] = [
  ["black", "luma(0%)"], ["gray", "luma(66.67%)"], ["silver", "luma(86.67%)"], ["white", "luma(100%)"],
  ["navy", "#001f3f"], ["blue", "#0074d9"], ["aqua", "#7fdbff"], ["teal", "#39cccc"], ["eastern", "#239dad"],
  ["purple", "#b10dc9"], ["fuchsia", "#f012be"], ["maroon", "#85144b"], ["red", "#ff4136"], ["orange", "#ff851b"],
  ["yellow", "#ffdc00"], ["olive", "#3d9970"], ["green", "#2ecc40"], ["lime", "#01ff70"],
];

export const PAINTS: readonly TypstBuiltin[] = [
  createTypeBuiltin("color", "A colour in one of several colour spaces; build one with `rgb`, `luma`, `oklch` and kin.", undefined, COLOR_MEMBERS),
  LUMA, OKLAB, OKLCH, RGB, CMYK,
  ...NAMED_COLORS.map(([name, value]) => createConstantBuiltin(name, `The predefined colour \`${value}\`.`)),
  createTypeBuiltin("gradient", "A colour gradient, built with `gradient.linear`, `gradient.radial` or `gradient.conic`.", undefined, GRADIENT_MEMBERS),
  createTypeBuiltin("tiling", "A paint that repeats a piece of content as a tile.", [
    createPositionalParam("body", "content", "The content of one tile."),
    createNamedParam("size", "auto | array", "auto", "The size of one tile; `auto` uses the content's size."),
    createNamedParam("spacing", "array", "(0pt, 0pt)", "The gap between tiles."),
    PAINT_RELATIVE,
  ], []),
  createTypeBuiltin("stroke", "Describes how to draw a line: paint, thickness, caps, joins and dashes.", [
    createNamedParam("paint", "auto | color | gradient | tiling", "auto", "The stroke's paint; `auto` means black."),
    createNamedParam("thickness", "auto | length", "auto", "The stroke's thickness; `auto` means 1pt."),
    createNamedParam("cap", "auto | str", "auto", "The line ends: `\"butt\"`, `\"round\"` or `\"square\"`."),
    createNamedParam("join", "auto | str", "auto", "The corners: `\"miter\"`, `\"round\"` or `\"bevel\"`."),
    createNamedParam("dash", "none | auto | str | array | dictionary", "auto", "The dash pattern, such as `\"dashed\"` or `(3pt, 1pt)`."),
    createNamedParam("miter-limit", "auto | float", "auto", "The ratio past which a miter join is beveled; `auto` means 4."),
  ], []),
];
