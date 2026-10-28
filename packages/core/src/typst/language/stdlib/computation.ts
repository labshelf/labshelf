// Typst's math, calc module, introspection and data-loading categories.
import { createFunctionBuiltin, createModuleBuiltin, createNamedParam, createPositionalParam, createTypeBuiltin, createConstantBuiltin, createVariadicParam, type TypstBuiltin } from "./typstBuiltin";

// Catalogues Typst's math category: the `math` module's elements and styles, plus the `sym` and `emoji` modules.
const STROKE = "none | length | color | gradient | stroke | tiling | dictionary";
const DELIM = "none | str | array | symbol";
const GAP = "0% + 0.2em";

const bodyOnly = (name: string, doc: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam("body", "content", "The content to set.")], "content");

const sized = (name: string, doc: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [
    createPositionalParam("body", "content", "The expression to wrap."),
    createNamedParam("size", "relative", "100% + 0pt", "The size of the delimiters, relative to the wrapped content's height."),
  ], "content");

const annotated = (name: string, what: string, below: boolean): TypstBuiltin =>
  createFunctionBuiltin(name, `Places a horizontal ${what} ${below ? "under" : "over"} an expression, with an optional annotation.`, [
    createPositionalParam("body", "content", "The expression to mark."),
    createPositionalParam("annotation", "none | content", `The annotation ${below ? "below" : "above"} the ${what}.`, "none"),
  ], "content");

const sizeStyle = (name: string, doc: string, cramped: boolean): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [
    createPositionalParam("body", "content", "The content to size."),
    createNamedParam("cramped", "bool", String(cramped), "Whether to impose a height restriction on exponents, as in a denominator."),
  ], "content");

const MEMBERS: readonly TypstBuiltin[] = [
  createFunctionBuiltin("equation", "A mathematical equation, written between `$` signs; spaces inside the dollars make it a block.", [
    createPositionalParam("body", "content", "The contents of the equation."),
    createNamedParam("block", "bool", "false", "Whether the equation is displayed as a separate block."),
    createNamedParam("numbering", "none | str | function", "none", "How to number block-level equations."),
    createNamedParam("number-align", "alignment", "end + horizon", "The alignment of the equation number."),
    createNamedParam("supplement", "none | auto | content | function", "auto", "A supplement placed before the number when the equation is referenced."),
    createNamedParam("alt", "none | str", "none", "An alternative description of the equation for assistive technology."),
  ], "content"),
  createFunctionBuiltin("frac", "A mathematical fraction, also written as `a / b` in math mode.", [
    createPositionalParam("num", "content", "The fraction's numerator."),
    createPositionalParam("denom", "content", "The fraction's denominator."),
    createNamedParam("style", "str", "\"vertical\"", "How the fraction is laid out: `\"vertical\"`, `\"skewed\"` or `\"horizontal\"`."),
  ], "content"),
  createFunctionBuiltin("binom", "A binomial coefficient.", [
    createPositionalParam("upper", "content", "The upper index."),
    createVariadicParam("lower", "content", "The lower index; several values are separated by commas."),
  ], "content"),
  createFunctionBuiltin("sqrt", "A square root.", [createPositionalParam("radicand", "content", "The expression under the root.")], "content"),
  createFunctionBuiltin("root", "A general root with an optional index.", [
    createPositionalParam("index", "none | content", "Which root of the radicand to take; `none` gives a square root."),
    createPositionalParam("radicand", "content", "The expression under the root."),
  ], "content"),
  createFunctionBuiltin("vec", "A column vector.", [
    createVariadicParam("children", "content", "The elements of the vector."),
    createNamedParam("delim", DELIM, "(\"(\", \")\")", "The delimiters around the vector."),
    createNamedParam("align", "alignment", "center", "The horizontal alignment of each element."),
    createNamedParam("gap", "relative", GAP, "The gap between elements."),
  ], "content"),
  createFunctionBuiltin("mat", "A matrix; rows are separated by `;` and cells by `,`.", [
    createVariadicParam("rows", "array", "The rows of the matrix, each an array of cells."),
    createNamedParam("delim", DELIM, "(\"(\", \")\")", "The delimiters around the matrix."),
    createNamedParam("align", "alignment", "center", "The horizontal alignment of each cell."),
    createNamedParam("augment", "none | int | dictionary", "none", "Where to draw augmentation lines between rows or columns."),
    createNamedParam("gap", "relative", "0% + 0pt", "The gap between rows and columns; overrides `row-gap` and `column-gap` when set."),
    createNamedParam("row-gap", "relative", GAP, "The gap between rows."),
    createNamedParam("column-gap", "relative", "0% + 0.5em", "The gap between columns."),
  ], "content"),
  createFunctionBuiltin("cases", "A case distinction; branches are separated by commas.", [
    createVariadicParam("children", "content", "The branches of the case distinction."),
    createNamedParam("delim", DELIM, "(\"{\", \"}\")", "The delimiter around the branches."),
    createNamedParam("reverse", "bool", "false", "Whether the delimiter is placed on the right instead of the left."),
    createNamedParam("gap", "relative", GAP, "The gap between branches."),
  ], "content"),
  createFunctionBuiltin("lr", "Scales delimiters to the height of the content between them.", [
    createPositionalParam("body", "content", "The delimited content, including the delimiters."),
    createNamedParam("size", "relative", "100% + 0pt", "The size of the delimiters, relative to the wrapped content's height."),
  ], "content"),
  createFunctionBuiltin("mid", "Scales a delimiter in the middle of an `lr` group to the group's height.", [
    createPositionalParam("body", "content", "The delimiter to scale."),
  ], "content"),
  sized("abs", "Wraps an expression in absolute-value bars."),
  sized("norm", "Wraps an expression in norm bars."),
  sized("floor", "Wraps an expression in floor brackets."),
  sized("ceil", "Wraps an expression in ceiling brackets."),
  sized("round", "Wraps an expression in rounding brackets."),
  createFunctionBuiltin("attach", "Attaches sub- and superscripts to a base in any of six positions.", [
    createPositionalParam("base", "content", "The base to attach to."),
    createNamedParam("t", "none | content", "none", "The top attachment, a limit above or a superscript."),
    createNamedParam("b", "none | content", "none", "The bottom attachment, a limit below or a subscript."),
    createNamedParam("tl", "none | content", "none", "The top-left attachment, before the base."),
    createNamedParam("bl", "none | content", "none", "The bottom-left attachment, before the base."),
    createNamedParam("tr", "none | content", "none", "The top-right attachment, after the base."),
    createNamedParam("br", "none | content", "none", "The bottom-right attachment, after the base."),
  ], "content"),
  createFunctionBuiltin("scripts", "Forces a base to show its attachments as scripts.", [createPositionalParam("body", "content", "The base.")], "content"),
  createFunctionBuiltin("limits", "Forces a base to show its attachments as limits above and below.", [
    createPositionalParam("body", "content", "The base."),
    createNamedParam("inline", "bool", "true", "Whether limits are also used in inline equations."),
  ], "content"),
  createFunctionBuiltin("primes", "Grouped primes, as written with `'` in math mode.", [createPositionalParam("count", "int", "The number of primes.")], "content"),
  createFunctionBuiltin("accent", "Puts an accent mark over a base.", [
    createPositionalParam("base", "content", "The base to accent."),
    createPositionalParam("accent", "str | content", "The accent, such as `arrow` or `\"^\"`."),
    createNamedParam("size", "relative", "100% + 0pt", "The width of the accent, relative to the base's width."),
    createNamedParam("dotless", "bool", "true", "Whether `i` and `j` lose their dot under top accents."),
  ], "content"),
  createFunctionBuiltin("cancel", "Draws a line across an expression to show it cancels out.", [
    createPositionalParam("body", "content", "The expression to cancel."),
    createNamedParam("length", "relative", "100% + 3pt", "The line's length, relative to the diagonal of the expression."),
    createNamedParam("inverted", "bool", "false", "Whether the line goes from top-left to bottom-right instead."),
    createNamedParam("cross", "bool", "false", "Whether to draw two crossing lines."),
    createNamedParam("angle", "auto | angle | function", "auto", "The line's angle; a function receives the default angle."),
    createNamedParam("stroke", STROKE, "0.5pt", "How to stroke the line."),
  ], "content"),
  createFunctionBuiltin("class", "Treats content as a given math class for spacing, such as `\"relation\"` or `\"large\"`.", [
    createPositionalParam("class", "str", "The math class, such as `\"normal\"`, `\"binary\"` or `\"relation\"`."),
    createPositionalParam("body", "content", "The content to classify."),
  ], "content"),
  createFunctionBuiltin("op", "A text operator such as `lim` or `max`, set upright with operator spacing.", [
    createPositionalParam("text", "content", "The operator's text."),
    createNamedParam("limits", "bool", "false", "Whether attachments are shown as limits in display mode."),
  ], "content"),
  createFunctionBuiltin("stretch", "Stretches a glyph, such as an arrow, to a width or height.", [
    createPositionalParam("body", "content", "The glyph to stretch."),
    createNamedParam("size", "relative", "100% + 0pt", "The size to stretch to, relative to the glyph's natural size or its attachments."),
  ], "content"),
  bodyOnly("underline", "Draws a line under an expression."),
  bodyOnly("overline", "Draws a line over an expression."),
  annotated("underbrace", "brace", true),
  annotated("overbrace", "brace", false),
  annotated("underbracket", "bracket", true),
  annotated("overbracket", "bracket", false),
  annotated("underparen", "parenthesis", true),
  annotated("overparen", "parenthesis", false),
  annotated("undershell", "tortoise-shell bracket", true),
  annotated("overshell", "tortoise-shell bracket", false),
  bodyOnly("bold", "Sets an expression in bold."),
  bodyOnly("italic", "Sets an expression in italic."),
  bodyOnly("upright", "Sets an expression upright, not italic."),
  bodyOnly("serif", "Sets an expression in a serif font, the default in math."),
  bodyOnly("sans", "Sets an expression in a sans-serif font."),
  bodyOnly("mono", "Sets an expression in a monospace font."),
  bodyOnly("cal", "Sets an expression in calligraphic letters."),
  bodyOnly("scr", "Sets an expression in script letters."),
  bodyOnly("frak", "Sets an expression in Fraktur letters."),
  bodyOnly("bb", "Sets an expression in blackboard-bold letters."),
  sizeStyle("display", "Forces display style, as in a block equation.", false),
  sizeStyle("inline", "Forces inline style, as in an inline equation.", false),
  sizeStyle("script", "Forces script size, as in a subscript.", true),
  sizeStyle("sscript", "Forces second-level script size, as in a subscript of a subscript.", true),
];

export const MATH: readonly TypstBuiltin[] = [
  createModuleBuiltin("math", "Mathematical typesetting; its members are available unqualified inside `$` equations.", MEMBERS),
  createModuleBuiltin("sym", "Named symbols such as `sym.arrow.r` or `sym.alpha`, available unqualified in math mode."),
  createModuleBuiltin("emoji", "Named emoji such as `emoji.face` or `emoji.rocket`."),
];

// Catalogues Typst's `calc` module of numeric functions and constants.
const NUM = "int | float";
const DEC = "int | float | decimal";
const unary = (name: string, doc: string, type: string, returns: string, param = "value"): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam(param, type, "The input value.")], returns);
const binary = (name: string, doc: string, type: string, a: string, b: string, returns: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam(a, type, "The first operand."), createPositionalParam(b, type, "The second operand.")], returns);

export const CALC = createModuleBuiltin("calc", "Calculations and processing of numeric values.", [
  unary("abs", "The absolute value of a numeric value.", "int | float | length | angle | ratio | fraction | decimal", "any"),
  createFunctionBuiltin("pow", "Raises a value to some exponent.", [
    createPositionalParam("base", DEC, "The base of the power."), createPositionalParam("exponent", NUM, "The exponent of the power."),
  ], "int | float | decimal"),
  unary("exp", "Raises e to some exponent.", NUM, "float", "exponent"),
  unary("sqrt", "The square root of a number.", NUM, "float"),
  createFunctionBuiltin("root", "The real nth root of a number.", [
    createPositionalParam("radicand", "float", "The number whose root to take."), createPositionalParam("index", "int", "Which root to take."),
  ], "float"),
  unary("sin", "The sine of an angle; plain numbers are radians.", "int | float | angle", "float", "angle"),
  unary("cos", "The cosine of an angle; plain numbers are radians.", "int | float | angle", "float", "angle"),
  unary("tan", "The tangent of an angle; plain numbers are radians.", "int | float | angle", "float", "angle"),
  unary("asin", "The arcsine of a number between -1 and 1.", NUM, "angle"),
  unary("acos", "The arccosine of a number between -1 and 1.", NUM, "angle"),
  unary("atan", "The arctangent of a number.", NUM, "angle"),
  binary("atan2", "The four-quadrant arctangent of a coordinate pair.", NUM, "x", "y", "angle"),
  unary("sinh", "The hyperbolic sine of a hyperbolic angle.", NUM, "float"),
  unary("cosh", "The hyperbolic cosine of a hyperbolic angle.", NUM, "float"),
  unary("tanh", "The hyperbolic tangent of a hyperbolic angle.", NUM, "float"),
  createFunctionBuiltin("log", "The logarithm of a number, in base 10 unless `base` says otherwise.", [
    createPositionalParam("value", NUM, "The number whose logarithm to take."), createNamedParam("base", "float", "10.0", "The base of the logarithm."),
  ], "float"),
  unary("ln", "The natural logarithm of a number.", NUM, "float"),
  unary("fact", "The factorial of a number.", "int", "int", "number"),
  binary("perm", "The number of permutations of `numbers` items out of `base`.", "int", "base", "numbers", "int"),
  binary("binom", "The binomial coefficient of n over k.", "int", "n", "k", "int"),
  binary("gcd", "The greatest common divisor of two integers.", "int", "a", "b", "int"),
  binary("lcm", "The least common multiple of two integers.", "int", "a", "b", "int"),
  unary("floor", "Rounds a number down to the nearest integer.", DEC, "int | decimal"),
  unary("ceil", "Rounds a number up to the nearest integer.", DEC, "int | decimal"),
  unary("trunc", "The integer part of a number.", DEC, "int | decimal"),
  unary("fract", "The fractional part of a number.", DEC, "int | float | decimal"),
  createFunctionBuiltin("round", "Rounds a number to the nearest integer, or to `digits` decimal places.", [
    createPositionalParam("value", DEC, "The number to round."), createNamedParam("digits", "int", "0", "How many decimal places to keep."),
  ], "int | float | decimal"),
  createFunctionBuiltin("clamp", "Clamps a number between a minimum and a maximum.", [
    createPositionalParam("value", DEC, "The number to clamp."), createPositionalParam("min", DEC, "The inclusive minimum."), createPositionalParam("max", DEC, "The inclusive maximum."),
  ], "int | float | decimal"),
  createFunctionBuiltin("min", "The smallest of a sequence of values.", [createVariadicParam("values", "any", "The values to compare.")], "any"),
  createFunctionBuiltin("max", "The largest of a sequence of values.", [createVariadicParam("values", "any", "The values to compare.")], "any"),
  unary("even", "Whether an integer is even.", "int", "bool"),
  unary("odd", "Whether an integer is odd.", "int", "bool"),
  binary("rem", "The remainder of a division, with the sign of the dividend.", DEC, "dividend", "divisor", "int | float | decimal"),
  binary("div-euclid", "The quotient of a Euclidean division.", DEC, "dividend", "divisor", "int | float | decimal"),
  binary("rem-euclid", "The non-negative remainder of a Euclidean division.", DEC, "dividend", "divisor", "int | float | decimal"),
  binary("quo", "The quotient of a division, rounded down.", DEC, "dividend", "divisor", "int | float | decimal"),
  createFunctionBuiltin("norm", "The p-norm of a sequence of numbers.", [
    createVariadicParam("values", "float", "The numbers whose norm to take."),
    createNamedParam("p", "float", "2.0", "The p of the p-norm; `float.inf` gives the maximum norm."),
  ], "float"),
  createConstantBuiltin("pi", "The constant π."),
  createConstantBuiltin("tau", "The constant τ, twice π."),
  createConstantBuiltin("e", "Euler's number."),
  createConstantBuiltin("inf", "Positive infinity."),
]);

// Catalogues Typst's introspection category: counters, state, queries, locations and metadata.
const SELECTOR = "label | selector | location | function";
const AT = (what: string): TypstBuiltin =>
  createFunctionBuiltin("at", `The ${what} at a location in the document; needs context.`, [createPositionalParam("selector", SELECTOR, "Where to read the value, by a location or the first match of a selector.")], "any");

export const INTROSPECTION: readonly TypstBuiltin[] = [
  createTypeBuiltin("counter", "Counts pages, elements or anything else, such as `counter(heading)` or `counter(page)`.", [
    createPositionalParam("key", `str | ${SELECTOR}`, "What to count: an element function, a selector, a label, a location or a string key."),
  ], [
    createFunctionBuiltin("get", "The counter's value at the current location; needs context.", [], "int | array"),
    AT("counter's value"),
    createFunctionBuiltin("final", "The counter's value at the end of the document; needs context.", [], "int | array"),
    createFunctionBuiltin("display", "Shows the counter's current value with a numbering pattern; needs context.", [
      createPositionalParam("numbering", "auto | str | function", "The numbering pattern or function; `auto` uses the counted element's numbering.", "auto"),
      createNamedParam("both", "bool", "false", "Whether to show the current and the final value together."),
    ], "any"),
    createFunctionBuiltin("step", "Increases the counter by one at this place in the document.", [
      createNamedParam("level", "int", "1", "The depth at which to step, for hierarchical counters such as headings."),
    ], "content"),
    createFunctionBuiltin("update", "Sets the counter at this place in the document.", [
      createPositionalParam("update", "int | array | function", "The new value, or a function from the old value to the new one."),
    ], "content"),
  ]),
  createTypeBuiltin("state", "A value that changes across the document, read and updated by position.", [
    createPositionalParam("key", "str", "The key that identifies the state."),
    createPositionalParam("init", "any", "The initial value.", "none"),
  ], [
    createFunctionBuiltin("get", "The state's value at the current location; needs context.", [], "any"),
    AT("state's value"),
    createFunctionBuiltin("final", "The state's value at the end of the document; needs context.", [], "any"),
    createFunctionBuiltin("update", "Changes the state at this place in the document.", [
      createPositionalParam("update", "any", "The new value, or a function from the old value to the new one."),
    ], "content"),
  ]),
  createFunctionBuiltin("query", "Finds all elements in the document that match a selector; needs context.", [
    createPositionalParam("target", SELECTOR, "What to look for: an element function, a selector, a label or a location."),
  ], "array"),
  createFunctionBuiltin("locate", "The location of the one element that matches a selector; needs context.", [
    createPositionalParam("selector", SELECTOR, "The element to find; it must match exactly one."),
  ], "location"),
  createFunctionBuiltin("here", "The location of the current context; needs context.", [], "location"),
  createFunctionBuiltin("metadata", "Invisible content that holds a value, for retrieval with `query`.", [
    createPositionalParam("value", "any", "The value to embed."),
  ], "content"),
  createTypeBuiltin("location", "A position in the final document, obtained from `here`, `locate` or an element's `location()`.", undefined, [
    createFunctionBuiltin("page", "The page number of the location.", [], "int"),
    createFunctionBuiltin("position", "The page and the x and y coordinates of the location.", [], "dictionary"),
    createFunctionBuiltin("page-numbering", "The page numbering pattern in effect at the location.", [], "none | str | function"),
  ]),
];

// Catalogues Typst's data-loading category: reading files and decoding or encoding JSON, CSV, YAML, TOML, XML and CBOR.
const SOURCE = createPositionalParam("source", "str | bytes", "A path to the file, or its raw bytes.");

const encoder = (format: string, value: string, pretty: boolean): TypstBuiltin =>
  createFunctionBuiltin("encode", `Encodes a value as ${format}.`, [
    createPositionalParam("value", value, "The value to encode."),
    ...(pretty ? [createNamedParam("pretty", "bool", "true", "Whether to indent and break lines for readability.")] : []),
  ], format === "CBOR" ? "bytes" : "str");

export const DATA_LOADING: readonly TypstBuiltin[] = [
  createFunctionBuiltin("read", "Reads a file as text or as raw bytes.", [
    createPositionalParam("path", "str", "The path to the file."),
    createNamedParam("encoding", "none | str", "\"utf8\"", "The text encoding; `none` returns the raw bytes."),
  ], "str | bytes"),
  createFunctionBuiltin("csv", "Reads CSV data into an array of rows.", [
    SOURCE,
    createNamedParam("delimiter", "str", "\",\"", "The single-character column separator."),
    createNamedParam("row-type", "type", "array", "Whether each row is an `array` or, keyed by the header row, a `dictionary`."),
  ], "array"),
  createFunctionBuiltin("json", "Reads JSON data into Typst values.", [SOURCE], "any", [encoder("JSON", "any", true)]),
  createFunctionBuiltin("yaml", "Reads YAML data into Typst values.", [SOURCE], "any", [encoder("YAML", "any", false)]),
  createFunctionBuiltin("toml", "Reads TOML data into a dictionary.", [SOURCE], "dictionary", [encoder("TOML", "dictionary", true)]),
  createFunctionBuiltin("xml", "Reads XML data into an array of element dictionaries and strings.", [SOURCE], "array"),
  createFunctionBuiltin("cbor", "Reads CBOR data into Typst values.", [createPositionalParam("source", "str | bytes", "A path to the file, or its raw bytes.")], "any", [encoder("CBOR", "any", false)]),
];
