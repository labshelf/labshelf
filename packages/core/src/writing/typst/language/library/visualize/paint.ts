// Catalogues Typst's paints and strokes: colours with their spaces, gradients, tilings and stroke specs.
import { fn, named, pos, ty, val, variadic, type TypstBuiltin } from "../typstBuiltin";

const SPACE = named("space", "any", "oklab", "The colour space to interpolate in, such as `oklab` or `rgb`.");
const RELATIVE = named("relative", "auto | str", "auto", "What the paint is relative to: `\"self\"` or `\"parent\"`; `auto` picks per element.");
const STOPS = variadic("stops", "color | array", "The colour stops, each a colour or a `(color, ratio)` pair.");
const CENTER = named("center", "array", "(50%, 50%)", "The centre of the gradient.");

const constructor = (name: string, doc: string, components: string): TypstBuiltin =>
  fn(name, doc, [variadic("components", "int | float | ratio | angle | color", components)], "color");

const factor = (name: string, doc: string, param: string): TypstBuiltin =>
  fn(name, doc, [pos(param, "ratio", "How strongly to apply the change.")], "color");

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
  fn("mix", "Mixes colours together, optionally weighted.", [
    variadic("colors", "color | array", "The colours, each a colour or a `(color, weight)` pair."), SPACE,
  ], "color"),
  fn("components", "The colour's components in its own space.", [
    named("alpha", "bool", "true", "Whether to include the alpha component."),
  ], "array"),
  fn("space", "The colour space the colour is stored in.", [], "any"),
  fn("to-hex", "The colour as an sRGB hex string.", [], "str"),
  factor("lighten", "Lightens the colour by a factor.", "factor"),
  factor("darken", "Darkens the colour by a factor.", "factor"),
  factor("saturate", "Increases the colour's saturation by a factor.", "factor"),
  factor("desaturate", "Decreases the colour's saturation by a factor.", "factor"),
  factor("transparentize", "Makes the colour more transparent by a factor.", "scale"),
  factor("opacify", "Makes the colour more opaque by a factor.", "scale"),
  fn("negate", "The colour's complement.", [SPACE], "color"),
  fn("rotate", "Rotates the colour's hue by an angle.", [
    pos("angle", "angle", "The angle to rotate the hue by."),
    named("space", "any", "oklch", "The colour space whose hue is rotated."),
  ], "color"),
];

const GRADIENT_MEMBERS: readonly TypstBuiltin[] = [
  fn("linear", "A gradient that changes colour along a straight line.", [
    STOPS, SPACE, RELATIVE,
    named("dir", "direction", "ltr", "The direction of the gradient."),
  ], "gradient"),
  fn("radial", "A gradient that changes colour outward from a centre.", [
    STOPS, SPACE, RELATIVE, CENTER,
    named("radius", "ratio", "50%", "The radius of the end circle."),
    named("focal-center", "auto | array", "auto", "The centre of the start circle; `auto` uses `center`."),
    named("focal-radius", "ratio", "0%", "The radius of the start circle."),
  ], "gradient"),
  fn("conic", "A gradient that changes colour around a centre.", [
    STOPS,
    named("angle", "angle", "0deg", "The angle at which the gradient starts."),
    SPACE, RELATIVE, CENTER,
  ], "gradient"),
  fn("sample", "The colour at a position along the gradient.", [pos("t", "angle | ratio", "The position to sample.")], "color"),
  fn("sharp", "Turns the gradient into one with hard steps.", [
    pos("steps", "int", "The number of steps."),
    named("smoothness", "ratio", "0%", "How much to blur the step edges."),
  ], "gradient"),
  fn("repeat", "Repeats the gradient a number of times.", [
    pos("repetitions", "int", "How often to repeat."),
    named("mirror", "bool", "false", "Whether every second repetition is reversed."),
  ], "gradient"),
  fn("stops", "The gradient's colour stops.", [], "array"),
  fn("kind", "The gradient's constructor: `gradient.linear`, `gradient.radial` or `gradient.conic`.", [], "function"),
];

const NAMED_COLORS: readonly [string, string][] = [
  ["black", "luma(0%)"], ["gray", "luma(66.67%)"], ["silver", "luma(86.67%)"], ["white", "luma(100%)"],
  ["navy", "#001f3f"], ["blue", "#0074d9"], ["aqua", "#7fdbff"], ["teal", "#39cccc"], ["eastern", "#239dad"],
  ["purple", "#b10dc9"], ["fuchsia", "#f012be"], ["maroon", "#85144b"], ["red", "#ff4136"], ["orange", "#ff851b"],
  ["yellow", "#ffdc00"], ["olive", "#3d9970"], ["green", "#2ecc40"], ["lime", "#01ff70"],
];

export const PAINTS: readonly TypstBuiltin[] = [
  ty("color", "A colour in one of several colour spaces; build one with `rgb`, `luma`, `oklch` and kin.", undefined, COLOR_MEMBERS),
  LUMA, OKLAB, OKLCH, RGB, CMYK,
  ...NAMED_COLORS.map(([name, value]) => val(name, `The predefined colour \`${value}\`.`)),
  ty("gradient", "A colour gradient, built with `gradient.linear`, `gradient.radial` or `gradient.conic`.", undefined, GRADIENT_MEMBERS),
  ty("tiling", "A paint that repeats a piece of content as a tile.", [
    pos("body", "content", "The content of one tile."),
    named("size", "auto | array", "auto", "The size of one tile; `auto` uses the content's size."),
    named("spacing", "array", "(0pt, 0pt)", "The gap between tiles."),
    RELATIVE,
  ], []),
  ty("stroke", "Describes how to draw a line: paint, thickness, caps, joins and dashes.", [
    named("paint", "auto | color | gradient | tiling", "auto", "The stroke's paint; `auto` means black."),
    named("thickness", "auto | length", "auto", "The stroke's thickness; `auto` means 1pt."),
    named("cap", "auto | str", "auto", "The line ends: `\"butt\"`, `\"round\"` or `\"square\"`."),
    named("join", "auto | str", "auto", "The corners: `\"miter\"`, `\"round\"` or `\"bevel\"`."),
    named("dash", "none | auto | str | array | dictionary", "auto", "The dash pattern, such as `\"dashed\"` or `(3pt, 1pt)`."),
    named("miter-limit", "auto | float", "auto", "The ratio past which a miter join is beveled; `auto` means 4."),
  ], []),
];
