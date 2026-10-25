// Catalogues Typst's text category: text styling, raw code and inline decorations.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, type TypstBuiltin } from "./typstBuiltin";

const STROKE = "none | length | color | gradient | stroke | tiling | dictionary";
const PAINT = "color | gradient | tiling";

const decoration = (name: string, doc: string, evade: boolean): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [
    createPositionalParam("body", "content", "The content to decorate."),
    createNamedParam("stroke", `auto | ${STROKE}`, "auto", "How to stroke the line; `auto` uses the text's fill and a thickness from the font."),
    createNamedParam("offset", "auto | length", "auto", "The line's position relative to the baseline; `auto` reads it from the font."),
    createNamedParam("extent", "length", "0pt", "How far the line extends past the start and end of the content."),
    ...(evade ? [createNamedParam("evade", "bool", "true", "Whether the line leaves gaps around glyphs that cross it.")] : []),
    createNamedParam("background", "bool", "false", "Whether the line is placed behind the content."),
  ], "content");

const script = (name: string, doc: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [
    createPositionalParam("body", "content", "The text to set in the script."),
    createNamedParam("typographic", "bool", "true", "Whether to prefer the font's dedicated glyphs over a scaled and shifted copy."),
    createNamedParam("baseline", "auto | length", "auto", "The baseline shift of synthesized glyphs; `auto` reads it from the font."),
    createNamedParam("size", "auto | length", "auto", "The font size of synthesized glyphs; `auto` reads it from the font."),
  ], "content");

export const TEXT: readonly TypstBuiltin[] = [
  createFunctionBuiltin("text", "Customizes the look and layout of text. Usually used in a set rule such as `#set text(font: \"New Computer Modern\")`.", [
    createPositionalParam("body", "content", "The content whose text is styled."),
    createNamedParam("font", "str | array | dictionary", "\"libertinus serif\"", "A font family name, or a priority list of names to fall back through."),
    createNamedParam("fallback", "bool", "true", "Whether to fall back to other installed fonts when a glyph is missing."),
    createNamedParam("style", "str", "\"normal\"", "The font style: `\"normal\"`, `\"italic\"` or `\"oblique\"`."),
    createNamedParam("weight", "int | str", "\"regular\"", "The font weight, as a number from 100 to 900 or a name such as `\"bold\"`."),
    createNamedParam("stretch", "ratio", "100%", "The desired width relative to the normal width, from 50% to 200%."),
    createNamedParam("size", "length", "11pt", "The font size."),
    createNamedParam("fill", PAINT, "luma(0%)", "The glyph fill paint."),
    createNamedParam("stroke", STROKE, "none", "How to stroke the glyph outlines."),
    createNamedParam("tracking", "length", "0pt", "The extra space between characters."),
    createNamedParam("spacing", "relative", "100%", "The width of word spaces, relative to the font's space width."),
    createNamedParam("cjk-latin-spacing", "none | auto", "auto", "Whether to add spacing between CJK and Latin characters automatically."),
    createNamedParam("baseline", "length", "0pt", "An amount to shift the text's baseline by."),
    createNamedParam("overhang", "bool", "true", "Whether certain glyphs may hang over into the margin in justified text."),
    createNamedParam("top-edge", "length | str", "\"cap-height\"", "The top end of the conceptual frame around the text, used for layout."),
    createNamedParam("bottom-edge", "length | str", "\"baseline\"", "The bottom end of the conceptual frame around the text, used for layout."),
    createNamedParam("lang", "str", "\"en\"", "An ISO 639-1/2/3 language code; it affects hyphenation, quotes and localized terms."),
    createNamedParam("region", "none | str", "none", "An ISO 3166-1 alpha-2 region code, refining `lang`."),
    createNamedParam("script", "auto | str", "auto", "The OpenType writing script, as an ISO 15924 code."),
    createNamedParam("dir", "auto | direction", "auto", "The dominant direction of the text; `auto` derives it from `lang`."),
    createNamedParam("hyphenate", "auto | bool", "auto", "Whether to hyphenate words; `auto` hyphenates only justified text."),
    createNamedParam("costs", "dictionary", "(hyphenation: 100%, runt: 100%, widow: 100%, orphan: 100%)", "The penalties the line breaker gives to hyphenation, runts, widows and orphans."),
    createNamedParam("kerning", "bool", "true", "Whether to apply kerning."),
    createNamedParam("alternates", "bool", "false", "Whether to use the font's stylistic alternates."),
    createNamedParam("stylistic-set", "none | int | array", "()", "Which stylistic sets of the font to apply, numbered from 1 to 20."),
    createNamedParam("ligatures", "bool", "true", "Whether to apply standard ligatures."),
    createNamedParam("discretionary-ligatures", "bool", "false", "Whether to apply discretionary ligatures."),
    createNamedParam("historical-ligatures", "bool", "false", "Whether to apply historical ligatures."),
    createNamedParam("number-type", "auto | str", "auto", "Which kind of numbers to use: `\"lining\"` or `\"old-style\"`."),
    createNamedParam("number-width", "auto | str", "auto", "The width of numbers: `\"proportional\"` or `\"tabular\"`."),
    createNamedParam("slashed-zero", "bool", "false", "Whether to use a slashed zero."),
    createNamedParam("fractions", "bool", "false", "Whether to turn numbers separated by a slash into fractions."),
    createNamedParam("features", "array | dictionary", "(:)", "Raw OpenType features to apply, as tags or a tag-to-value dictionary."),
  ], "content"),
  createFunctionBuiltin("raw", "Raw text with optional syntax highlighting, as written with backticks.", [
    createPositionalParam("text", "str", "The raw text."),
    createNamedParam("block", "bool", "false", "Whether the raw text is displayed as a separate block."),
    createNamedParam("lang", "none | str", "none", "The language to highlight the text in, such as `\"rust\"`."),
    createNamedParam("align", "alignment", "start", "The horizontal alignment of each line of a raw block."),
    createNamedParam("syntaxes", "str | bytes | array", "()", "Extra sublime-syntax files that add highlightable languages."),
    createNamedParam("theme", "none | auto | str | bytes", "auto", "A tmTheme file for highlighting; `none` disables highlighting."),
    createNamedParam("tab-size", "int", "2", "The width of a tab, in spaces."),
  ], "content"),
  createFunctionBuiltin("smallcaps", "Displays text in small capitals.", [
    createPositionalParam("body", "content", "The content to display in small capitals."),
    createNamedParam("all", "bool", "false", "Whether to turn uppercase letters into small capitals as well."),
  ], "content"),
  script("sub", "Renders text in subscript."),
  script("super", "Renders text in superscript."),
  decoration("underline", "Underlines text.", true),
  decoration("overline", "Adds a line over text.", true),
  decoration("strike", "Strikes through text.", false),
  createFunctionBuiltin("highlight", "Highlights text with a background colour.", [
    createPositionalParam("body", "content", "The content to highlight."),
    createNamedParam("fill", `none | ${PAINT}`, "rgb(\"#fffd11a1\")", "The background colour."),
    createNamedParam("stroke", STROKE, "(:)", "The highlight's border colour."),
    createNamedParam("top-edge", "length | str", "\"ascender\"", "The top end of the highlight's bounding box."),
    createNamedParam("bottom-edge", "length | str", "\"descender\"", "The bottom end of the highlight's bounding box."),
    createNamedParam("extent", "length", "0pt", "How far the highlight extends past the start and end of the content."),
    createNamedParam("radius", "relative | dictionary", "(:)", "How much to round the highlight's corners."),
  ], "content"),
  createFunctionBuiltin("lorem", "Creates blind text, a given number of words of Lorem Ipsum.", [
    createPositionalParam("words", "int", "The number of words of blind text."),
  ], "str"),
  createFunctionBuiltin("linebreak", "Inserts a line break, as written with a backslash.", [
    createNamedParam("justify", "bool", "false", "Whether to justify the line before the break."),
  ], "content"),
  createFunctionBuiltin("smartquote", "A language-aware quote that reacts to its context, as written with `'` or `\"`.", [
    createNamedParam("double", "bool", "true", "Whether this is a double quote."),
    createNamedParam("enabled", "bool", "true", "Whether smart quotes are enabled; if not, the plain ASCII quote is shown."),
    createNamedParam("alternative", "bool", "false", "Whether to use the alternative quotes of the language."),
    createNamedParam("quotes", "auto | str | array | dictionary", "auto", "The quotes to use instead of the language's defaults."),
  ], "content"),
  createFunctionBuiltin("upper", "Converts a string or content to uppercase.", [
    createPositionalParam("text", "str | content", "The text to convert."),
  ], "str | content"),
  createFunctionBuiltin("lower", "Converts a string or content to lowercase.", [
    createPositionalParam("text", "str | content", "The text to convert."),
  ], "str | content"),
];
