// Catalogues Typst's math category: the `math` module's elements and styles, plus the `sym` and `emoji` modules.
import { createFunctionBuiltin, createModuleBuiltin, createNamedParam, createPositionalParam, createVariadicParam, type TypstBuiltin } from "./typstBuiltin";

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
