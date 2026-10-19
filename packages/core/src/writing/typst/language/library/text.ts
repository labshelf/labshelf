// Catalogues Typst's text category: text styling, raw code and inline decorations.
import { fn, named, pos, type TypstBuiltin } from "./typstBuiltin";

const STROKE = "none | length | color | gradient | stroke | tiling | dictionary";
const PAINT = "color | gradient | tiling";

const decoration = (name: string, doc: string, evade: boolean): TypstBuiltin =>
  fn(name, doc, [
    pos("body", "content", "The content to decorate."),
    named("stroke", `auto | ${STROKE}`, "auto", "How to stroke the line; `auto` uses the text's fill and a thickness from the font."),
    named("offset", "auto | length", "auto", "The line's position relative to the baseline; `auto` reads it from the font."),
    named("extent", "length", "0pt", "How far the line extends past the start and end of the content."),
    ...(evade ? [named("evade", "bool", "true", "Whether the line leaves gaps around glyphs that cross it.")] : []),
    named("background", "bool", "false", "Whether the line is placed behind the content."),
  ], "content");

const script = (name: string, doc: string): TypstBuiltin =>
  fn(name, doc, [
    pos("body", "content", "The text to set in the script."),
    named("typographic", "bool", "true", "Whether to prefer the font's dedicated glyphs over a scaled and shifted copy."),
    named("baseline", "auto | length", "auto", "The baseline shift of synthesized glyphs; `auto` reads it from the font."),
    named("size", "auto | length", "auto", "The font size of synthesized glyphs; `auto` reads it from the font."),
  ], "content");

export const TEXT: readonly TypstBuiltin[] = [
  fn("text", "Customizes the look and layout of text. Usually used in a set rule such as `#set text(font: \"New Computer Modern\")`.", [
    pos("body", "content", "The content whose text is styled."),
    named("font", "str | array | dictionary", "\"libertinus serif\"", "A font family name, or a priority list of names to fall back through."),
    named("fallback", "bool", "true", "Whether to fall back to other installed fonts when a glyph is missing."),
    named("style", "str", "\"normal\"", "The font style: `\"normal\"`, `\"italic\"` or `\"oblique\"`."),
    named("weight", "int | str", "\"regular\"", "The font weight, as a number from 100 to 900 or a name such as `\"bold\"`."),
    named("stretch", "ratio", "100%", "The desired width relative to the normal width, from 50% to 200%."),
    named("size", "length", "11pt", "The font size."),
    named("fill", PAINT, "luma(0%)", "The glyph fill paint."),
    named("stroke", STROKE, "none", "How to stroke the glyph outlines."),
    named("tracking", "length", "0pt", "The extra space between characters."),
    named("spacing", "relative", "100%", "The width of word spaces, relative to the font's space width."),
    named("cjk-latin-spacing", "none | auto", "auto", "Whether to add spacing between CJK and Latin characters automatically."),
    named("baseline", "length", "0pt", "An amount to shift the text's baseline by."),
    named("overhang", "bool", "true", "Whether certain glyphs may hang over into the margin in justified text."),
    named("top-edge", "length | str", "\"cap-height\"", "The top end of the conceptual frame around the text, used for layout."),
    named("bottom-edge", "length | str", "\"baseline\"", "The bottom end of the conceptual frame around the text, used for layout."),
    named("lang", "str", "\"en\"", "An ISO 639-1/2/3 language code; it affects hyphenation, quotes and localized terms."),
    named("region", "none | str", "none", "An ISO 3166-1 alpha-2 region code, refining `lang`."),
    named("script", "auto | str", "auto", "The OpenType writing script, as an ISO 15924 code."),
    named("dir", "auto | direction", "auto", "The dominant direction of the text; `auto` derives it from `lang`."),
    named("hyphenate", "auto | bool", "auto", "Whether to hyphenate words; `auto` hyphenates only justified text."),
    named("costs", "dictionary", "(hyphenation: 100%, runt: 100%, widow: 100%, orphan: 100%)", "The penalties the line breaker gives to hyphenation, runts, widows and orphans."),
    named("kerning", "bool", "true", "Whether to apply kerning."),
    named("alternates", "bool", "false", "Whether to use the font's stylistic alternates."),
    named("stylistic-set", "none | int | array", "()", "Which stylistic sets of the font to apply, numbered from 1 to 20."),
    named("ligatures", "bool", "true", "Whether to apply standard ligatures."),
    named("discretionary-ligatures", "bool", "false", "Whether to apply discretionary ligatures."),
    named("historical-ligatures", "bool", "false", "Whether to apply historical ligatures."),
    named("number-type", "auto | str", "auto", "Which kind of numbers to use: `\"lining\"` or `\"old-style\"`."),
    named("number-width", "auto | str", "auto", "The width of numbers: `\"proportional\"` or `\"tabular\"`."),
    named("slashed-zero", "bool", "false", "Whether to use a slashed zero."),
    named("fractions", "bool", "false", "Whether to turn numbers separated by a slash into fractions."),
    named("features", "array | dictionary", "(:)", "Raw OpenType features to apply, as tags or a tag-to-value dictionary."),
  ], "content"),
  fn("raw", "Raw text with optional syntax highlighting, as written with backticks.", [
    pos("text", "str", "The raw text."),
    named("block", "bool", "false", "Whether the raw text is displayed as a separate block."),
    named("lang", "none | str", "none", "The language to highlight the text in, such as `\"rust\"`."),
    named("align", "alignment", "start", "The horizontal alignment of each line of a raw block."),
    named("syntaxes", "str | bytes | array", "()", "Extra sublime-syntax files that add highlightable languages."),
    named("theme", "none | auto | str | bytes", "auto", "A tmTheme file for highlighting; `none` disables highlighting."),
    named("tab-size", "int", "2", "The width of a tab, in spaces."),
  ], "content"),
  fn("smallcaps", "Displays text in small capitals.", [
    pos("body", "content", "The content to display in small capitals."),
    named("all", "bool", "false", "Whether to turn uppercase letters into small capitals as well."),
  ], "content"),
  script("sub", "Renders text in subscript."),
  script("super", "Renders text in superscript."),
  decoration("underline", "Underlines text.", true),
  decoration("overline", "Adds a line over text.", true),
  decoration("strike", "Strikes through text.", false),
  fn("highlight", "Highlights text with a background colour.", [
    pos("body", "content", "The content to highlight."),
    named("fill", `none | ${PAINT}`, "rgb(\"#fffd11a1\")", "The background colour."),
    named("stroke", STROKE, "(:)", "The highlight's border colour."),
    named("top-edge", "length | str", "\"ascender\"", "The top end of the highlight's bounding box."),
    named("bottom-edge", "length | str", "\"descender\"", "The bottom end of the highlight's bounding box."),
    named("extent", "length", "0pt", "How far the highlight extends past the start and end of the content."),
    named("radius", "relative | dictionary", "(:)", "How much to round the highlight's corners."),
  ], "content"),
  fn("lorem", "Creates blind text, a given number of words of Lorem Ipsum.", [
    pos("words", "int", "The number of words of blind text."),
  ], "str"),
  fn("linebreak", "Inserts a line break, as written with a backslash.", [
    named("justify", "bool", "false", "Whether to justify the line before the break."),
  ], "content"),
  fn("smartquote", "A language-aware quote that reacts to its context, as written with `'` or `\"`.", [
    named("double", "bool", "true", "Whether this is a double quote."),
    named("enabled", "bool", "true", "Whether smart quotes are enabled; if not, the plain ASCII quote is shown."),
    named("alternative", "bool", "false", "Whether to use the alternative quotes of the language."),
    named("quotes", "auto | str | array | dictionary", "auto", "The quotes to use instead of the language's defaults."),
  ], "content"),
  fn("upper", "Converts a string or content to uppercase.", [
    pos("text", "str | content", "The text to convert."),
  ], "str | content"),
  fn("lower", "Converts a string or content to lowercase.", [
    pos("text", "str | content", "The text to convert."),
  ], "str | content"),
];
