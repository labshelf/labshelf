// Catalogues Typst's math category: the `math` module's elements and styles, plus the `sym` and `emoji` modules.
import { fn, mod, named, pos, variadic, type TypstBuiltin } from "./typstBuiltin";

const STROKE = "none | length | color | gradient | stroke | tiling | dictionary";
const DELIM = "none | str | array | symbol";
const GAP = "0% + 0.2em";

const bodyOnly = (name: string, doc: string): TypstBuiltin =>
  fn(name, doc, [pos("body", "content", "The content to set.")], "content");

const sized = (name: string, doc: string): TypstBuiltin =>
  fn(name, doc, [
    pos("body", "content", "The expression to wrap."),
    named("size", "relative", "100% + 0pt", "The size of the delimiters, relative to the wrapped content's height."),
  ], "content");

const annotated = (name: string, what: string, below: boolean): TypstBuiltin =>
  fn(name, `Places a horizontal ${what} ${below ? "under" : "over"} an expression, with an optional annotation.`, [
    pos("body", "content", "The expression to mark."),
    pos("annotation", "none | content", `The annotation ${below ? "below" : "above"} the ${what}.`, "none"),
  ], "content");

const sizeStyle = (name: string, doc: string, cramped: boolean): TypstBuiltin =>
  fn(name, doc, [
    pos("body", "content", "The content to size."),
    named("cramped", "bool", String(cramped), "Whether to impose a height restriction on exponents, as in a denominator."),
  ], "content");

const MEMBERS: readonly TypstBuiltin[] = [
  fn("equation", "A mathematical equation, written between `$` signs; spaces inside the dollars make it a block.", [
    pos("body", "content", "The contents of the equation."),
    named("block", "bool", "false", "Whether the equation is displayed as a separate block."),
    named("numbering", "none | str | function", "none", "How to number block-level equations."),
    named("number-align", "alignment", "end + horizon", "The alignment of the equation number."),
    named("supplement", "none | auto | content | function", "auto", "A supplement placed before the number when the equation is referenced."),
    named("alt", "none | str", "none", "An alternative description of the equation for assistive technology."),
  ], "content"),
  fn("frac", "A mathematical fraction, also written as `a / b` in math mode.", [
    pos("num", "content", "The fraction's numerator."),
    pos("denom", "content", "The fraction's denominator."),
    named("style", "str", "\"vertical\"", "How the fraction is laid out: `\"vertical\"`, `\"skewed\"` or `\"horizontal\"`."),
  ], "content"),
  fn("binom", "A binomial coefficient.", [
    pos("upper", "content", "The upper index."),
    variadic("lower", "content", "The lower index; several values are separated by commas."),
  ], "content"),
  fn("sqrt", "A square root.", [pos("radicand", "content", "The expression under the root.")], "content"),
  fn("root", "A general root with an optional index.", [
    pos("index", "none | content", "Which root of the radicand to take; `none` gives a square root."),
    pos("radicand", "content", "The expression under the root."),
  ], "content"),
  fn("vec", "A column vector.", [
    variadic("children", "content", "The elements of the vector."),
    named("delim", DELIM, "(\"(\", \")\")", "The delimiters around the vector."),
    named("align", "alignment", "center", "The horizontal alignment of each element."),
    named("gap", "relative", GAP, "The gap between elements."),
  ], "content"),
  fn("mat", "A matrix; rows are separated by `;` and cells by `,`.", [
    variadic("rows", "array", "The rows of the matrix, each an array of cells."),
    named("delim", DELIM, "(\"(\", \")\")", "The delimiters around the matrix."),
    named("align", "alignment", "center", "The horizontal alignment of each cell."),
    named("augment", "none | int | dictionary", "none", "Where to draw augmentation lines between rows or columns."),
    named("gap", "relative", "0% + 0pt", "The gap between rows and columns; overrides `row-gap` and `column-gap` when set."),
    named("row-gap", "relative", GAP, "The gap between rows."),
    named("column-gap", "relative", "0% + 0.5em", "The gap between columns."),
  ], "content"),
  fn("cases", "A case distinction; branches are separated by commas.", [
    variadic("children", "content", "The branches of the case distinction."),
    named("delim", DELIM, "(\"{\", \"}\")", "The delimiter around the branches."),
    named("reverse", "bool", "false", "Whether the delimiter is placed on the right instead of the left."),
    named("gap", "relative", GAP, "The gap between branches."),
  ], "content"),
  fn("lr", "Scales delimiters to the height of the content between them.", [
    pos("body", "content", "The delimited content, including the delimiters."),
    named("size", "relative", "100% + 0pt", "The size of the delimiters, relative to the wrapped content's height."),
  ], "content"),
  fn("mid", "Scales a delimiter in the middle of an `lr` group to the group's height.", [
    pos("body", "content", "The delimiter to scale."),
  ], "content"),
  sized("abs", "Wraps an expression in absolute-value bars."),
  sized("norm", "Wraps an expression in norm bars."),
  sized("floor", "Wraps an expression in floor brackets."),
  sized("ceil", "Wraps an expression in ceiling brackets."),
  sized("round", "Wraps an expression in rounding brackets."),
  fn("attach", "Attaches sub- and superscripts to a base in any of six positions.", [
    pos("base", "content", "The base to attach to."),
    named("t", "none | content", "none", "The top attachment, a limit above or a superscript."),
    named("b", "none | content", "none", "The bottom attachment, a limit below or a subscript."),
    named("tl", "none | content", "none", "The top-left attachment, before the base."),
    named("bl", "none | content", "none", "The bottom-left attachment, before the base."),
    named("tr", "none | content", "none", "The top-right attachment, after the base."),
    named("br", "none | content", "none", "The bottom-right attachment, after the base."),
  ], "content"),
  fn("scripts", "Forces a base to show its attachments as scripts.", [pos("body", "content", "The base.")], "content"),
  fn("limits", "Forces a base to show its attachments as limits above and below.", [
    pos("body", "content", "The base."),
    named("inline", "bool", "true", "Whether limits are also used in inline equations."),
  ], "content"),
  fn("primes", "Grouped primes, as written with `'` in math mode.", [pos("count", "int", "The number of primes.")], "content"),
  fn("accent", "Puts an accent mark over a base.", [
    pos("base", "content", "The base to accent."),
    pos("accent", "str | content", "The accent, such as `arrow` or `\"^\"`."),
    named("size", "relative", "100% + 0pt", "The width of the accent, relative to the base's width."),
    named("dotless", "bool", "true", "Whether `i` and `j` lose their dot under top accents."),
  ], "content"),
  fn("cancel", "Draws a line across an expression to show it cancels out.", [
    pos("body", "content", "The expression to cancel."),
    named("length", "relative", "100% + 3pt", "The line's length, relative to the diagonal of the expression."),
    named("inverted", "bool", "false", "Whether the line goes from top-left to bottom-right instead."),
    named("cross", "bool", "false", "Whether to draw two crossing lines."),
    named("angle", "auto | angle | function", "auto", "The line's angle; a function receives the default angle."),
    named("stroke", STROKE, "0.5pt", "How to stroke the line."),
  ], "content"),
  fn("class", "Treats content as a given math class for spacing, such as `\"relation\"` or `\"large\"`.", [
    pos("class", "str", "The math class, such as `\"normal\"`, `\"binary\"` or `\"relation\"`."),
    pos("body", "content", "The content to classify."),
  ], "content"),
  fn("op", "A text operator such as `lim` or `max`, set upright with operator spacing.", [
    pos("text", "content", "The operator's text."),
    named("limits", "bool", "false", "Whether attachments are shown as limits in display mode."),
  ], "content"),
  fn("stretch", "Stretches a glyph, such as an arrow, to a width or height.", [
    pos("body", "content", "The glyph to stretch."),
    named("size", "relative", "100% + 0pt", "The size to stretch to, relative to the glyph's natural size or its attachments."),
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
  mod("math", "Mathematical typesetting; its members are available unqualified inside `$` equations.", MEMBERS),
  mod("sym", "Named symbols such as `sym.arrow.r` or `sym.alpha`, available unqualified in math mode."),
  mod("emoji", "Named emoji such as `emoji.face` or `emoji.rocket`."),
];
