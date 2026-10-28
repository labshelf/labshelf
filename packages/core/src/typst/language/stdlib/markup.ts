// Typst's document model and text categories: headings, lists, tables, figures, references, and text formatting.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, type TypstBuiltin } from "./typstBuiltin";
import { createCellGrid, type TypstGridKind } from "./layout";

// Catalogues Typst's model category: the document's semantic structure, from headings to tables and citations.

const SUPPLEMENT = "none | auto | content | function";
const NUMBERING = "none | str | function";
const children = (doc: string) => createPositionalParam("children", "content", doc);

const listLike = (kind: "list" | "enum"): readonly ReturnType<typeof createNamedParam>[] => [
  createNamedParam("tight", "bool", "true", "Whether the items are spaced like a paragraph's lines rather than like paragraphs."),
  createNamedParam("indent", "length", "0pt", "The indent of each item."),
  createNamedParam("body-indent", "length", "0.5em", `The space between the ${kind === "list" ? "marker" : "number"} and the body of each item.`),
  createNamedParam("spacing", "auto | length", "auto", "The spacing between items; `auto` uses paragraph leading for tight lists and paragraph spacing otherwise."),
];

const TABLE: TypstGridKind = { name: "table", inset: "0% + 5pt", stroke: "1pt + black" };

export const MODEL: readonly TypstBuiltin[] = [
  createFunctionBuiltin("heading", "A section heading, as written with `=` signs.", [
    createPositionalParam("body", "content", "The heading's title."),
    createNamedParam("level", "auto | int", "auto", "The absolute nesting depth; `auto` computes it from `offset` and `depth`."),
    createNamedParam("depth", "int", "1", "The relative nesting depth, as given by the number of `=` signs."),
    createNamedParam("offset", "int", "0", "The starting offset of each heading's level."),
    createNamedParam("numbering", NUMBERING, "none", "How to number the heading, such as `\"1.a)\"`."),
    createNamedParam("supplement", SUPPLEMENT, "auto", "A supplement for references to the heading; `auto` uses a localized word."),
    createNamedParam("outlined", "bool", "true", "Whether the heading appears in the outline."),
    createNamedParam("bookmarked", "auto | bool", "auto", "Whether the heading appears as a bookmark in the PDF; `auto` follows `outlined`."),
    createNamedParam("hanging-indent", "auto | length", "auto", "The indent of all but the first line of a heading; `auto` aligns them with the title after the number."),
  ], "content"),
  createFunctionBuiltin("par", "A logical subdivision of textual content, separated by a blank line.", [
    createPositionalParam("body", "content", "The paragraph's contents."),
    createNamedParam("leading", "length", "0.65em", "The spacing between lines."),
    createNamedParam("spacing", "length", "1.2em", "The spacing between paragraphs."),
    createNamedParam("justify", "bool", "false", "Whether to justify text in its line."),
    createNamedParam("linebreaks", "auto | str", "auto", "How to break lines: `\"simple\"` or `\"optimized\"`; `auto` optimizes only justified text."),
    createNamedParam("first-line-indent", "length | dictionary", "(amount: 0pt, all: false)", "The indent of the first line of a paragraph, optionally of every paragraph."),
    createNamedParam("hanging-indent", "length", "0pt", "The indent of all but the first line of a paragraph."),
  ], "content"),
  createFunctionBuiltin("parbreak", "A paragraph break, as written with a blank line.", [], "content"),
  createFunctionBuiltin("list", "A bullet list, as written with `-` items.", [
    children("The list's items."),
    createNamedParam("marker", "content | array | function", "([•], [‣], [–])", "The marker of each item, or one marker per nesting level."),
    ...listLike("list"),
  ], "content", [
    createFunctionBuiltin("item", "A bullet list item.", [createPositionalParam("body", "content", "The item's body.")], "content"),
  ]),
  createFunctionBuiltin("enum", "A numbered list, as written with `+` or `1.` items.", [
    children("The enumeration's items."),
    createNamedParam("numbering", "str | function", "\"1.\"", "How to number the items, such as `\"a)\"`."),
    createNamedParam("start", "auto | int", "auto", "Which number to start with; `auto` starts at 1, or at the total for a reversed list."),
    createNamedParam("full", "bool", "false", "Whether to display the numbers of all parent items as well."),
    createNamedParam("reversed", "bool", "false", "Whether to number the items in reverse order."),
    createNamedParam("number-align", "alignment", "end + top", "How to align the numbers."),
    ...listLike("enum"),
  ], "content", [
    createFunctionBuiltin("item", "A numbered list item.", [
      createPositionalParam("number", "auto | int", "The item's number; `auto` continues from the previous item.", "auto"),
      createPositionalParam("body", "content", "The item's body."),
    ], "content"),
  ]),
  createFunctionBuiltin("terms", "A list of terms and their descriptions, as written with `/ Term: description`.", [
    children("The term list's items."),
    createNamedParam("tight", "bool", "true", "Whether the items are spaced like a paragraph's lines rather than like paragraphs."),
    createNamedParam("separator", "content", "h(0.6em, weak: true)", "The separator between a term and its description."),
    createNamedParam("indent", "length", "0pt", "The indent of each item."),
    createNamedParam("hanging-indent", "length", "2em", "The indent of every line of an item but the first."),
    createNamedParam("spacing", "auto | length", "auto", "The spacing between items."),
  ], "content", [
    createFunctionBuiltin("item", "A term list item.", [
      createPositionalParam("term", "content", "The term described by the item."),
      createPositionalParam("description", "content", "The description of the term."),
    ], "content"),
  ]),
  createFunctionBuiltin("figure", "A figure with an optional caption, numbered and referenceable by kind (image, table, raw).", [
    createPositionalParam("body", "content", "The content of the figure, often an image."),
    createNamedParam("placement", "none | auto | alignment", "none", "Where to float the figure: `top`, `bottom` or `auto`; `none` keeps it in the flow."),
    createNamedParam("scope", "str", "\"column\"", "Relative to which container a floating figure is placed: `\"column\"` or `\"parent\"`."),
    createNamedParam("caption", "none | content", "none", "The figure's caption."),
    createNamedParam("kind", "auto | str | function", "auto", "The kind of figure, used for numbering and selectors; `auto` infers it from the body."),
    createNamedParam("supplement", SUPPLEMENT, "auto", "The word in front of the figure number, such as \"Figure\"."),
    createNamedParam("numbering", NUMBERING, "\"1\"", "How to number the figure."),
    createNamedParam("gap", "length", "0.65em", "The space between the body and the caption."),
    createNamedParam("outlined", "bool", "true", "Whether the figure appears in an outline of figures."),
  ], "content", [
    createFunctionBuiltin("caption", "The caption of a figure, usually customized with set and show rules.", [
      createPositionalParam("body", "content", "The caption's text."),
      createNamedParam("position", "alignment", "bottom", "The caption's position relative to the body: `top` or `bottom`."),
      createNamedParam("separator", "auto | content", "auto", "The separator between the number and the caption text."),
    ], "content"),
  ]),
  ...createCellGrid(TABLE, "A table of items in rows and columns, with semantic header, footer and cells."),
  createFunctionBuiltin("link", "Links to a URL or a location in the document.", [
    createPositionalParam("dest", "str | label | location | dictionary", "The destination: a URL, a label, a location or a page-and-position dictionary."),
    createPositionalParam("body", "content", "The content to show for the link; it can be left out for a URL, which is then shown."),
  ], "content"),
  createFunctionBuiltin("ref", "A reference to a label or bibliography entry, as written with `@label`.", [
    createPositionalParam("target", "label", "The label to refer to."),
    createNamedParam("supplement", SUPPLEMENT, "auto", "A supplement shown in front of the number."),
    createNamedParam("form", "str", "\"normal\"", "The kind of reference: `\"normal\"` or `\"page\"`."),
  ], "content"),
  createFunctionBuiltin("cite", "Cites an entry of the bibliography.", [
    createPositionalParam("key", "label", "The citation key of the entry."),
    createNamedParam("supplement", "none | content", "none", "A supplement such as a page number."),
    createNamedParam("form", "none | str", "\"normal\"", "The citation form: `\"normal\"`, `\"prose\"`, `\"full\"`, `\"author\"` or `\"year\"`."),
    createNamedParam("style", "auto | str | bytes", "auto", "The citation style; `auto` uses the bibliography's style."),
  ], "content"),
  createFunctionBuiltin("bibliography", "A bibliography from BibLaTeX or Hayagriva files.", [
    createPositionalParam("sources", "str | bytes | array", "The path of a bibliography file, its raw bytes, or a list of either."),
    createNamedParam("title", "none | auto | content", "auto", "The title of the bibliography; `auto` uses a localized title."),
    createNamedParam("full", "bool", "false", "Whether to include all entries, not only the cited ones."),
    createNamedParam("style", "str | bytes", "\"ieee\"", "The bibliography style: a built-in style name or a CSL file."),
  ], "content"),
  createFunctionBuiltin("footnote", "A footnote at the bottom of the page.", [
    createPositionalParam("body", "content | label", "The footnote's content, or the label of another footnote to refer to it."),
    createNamedParam("numbering", "str | function", "\"1\"", "How to number footnotes."),
  ], "content"),
  createFunctionBuiltin("quote", "Displays a quote, inline or as a block, with an optional attribution.", [
    createPositionalParam("body", "content", "The quoted text."),
    createNamedParam("block", "bool", "false", "Whether the quote is a separate block."),
    createNamedParam("quotes", "auto | bool", "auto", "Whether to wrap the quote in quotation marks; `auto` adds them to inline quotes."),
    createNamedParam("attribution", "none | label | content", "none", "The quote's source, or a bibliography label to cite."),
  ], "content"),
  createFunctionBuiltin("outline", "A table of contents, of figures or of other elements.", [
    createNamedParam("title", "none | auto | content", "auto", "The outline's title; `auto` uses a localized title."),
    createNamedParam("target", "label | selector | location | function", "heading", "Which elements to list."),
    createNamedParam("depth", "none | int", "none", "The maximum heading level to include."),
    createNamedParam("indent", "auto | relative | function", "auto", "How to indent nested entries."),
  ], "content"),
  createFunctionBuiltin("document", "The document's metadata, set at the top of the file with `#set document(..)`.", [
    createNamedParam("title", "none | content", "none", "The document's title, embedded in the PDF."),
    createNamedParam("author", "str | array", "()", "The document's authors."),
    createNamedParam("description", "none | content", "none", "The document's description."),
    createNamedParam("keywords", "str | array", "()", "The document's keywords."),
    createNamedParam("date", "none | auto | datetime", "auto", "The document's creation date; `auto` uses the current date when the document is built."),
  ], "content"),
  createFunctionBuiltin("numbering", "Applies a numbering pattern such as `\"1.a\"` or a function to a sequence of numbers.", [
    createPositionalParam("numbering", "str | function", "The numbering pattern or function."),
    createPositionalParam("numbers", "int", "The numbers to format, as any number of arguments."),
  ], "any"),
  createFunctionBuiltin("emph", "Emphasizes content by toggling italics, as written with `_underscores_`.", [
    createPositionalParam("body", "content", "The content to emphasize."),
  ], "content"),
  createFunctionBuiltin("strong", "Strongly emphasizes content by setting it in bold, as written with `*stars*`.", [
    createPositionalParam("body", "content", "The content to emphasize."),
    createNamedParam("delta", "int", "300", "The font weight to add."),
  ], "content"),
];

// Catalogues Typst's text category: text styling, raw code and inline decorations.
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
