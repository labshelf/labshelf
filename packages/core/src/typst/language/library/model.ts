// Catalogues Typst's model category: the document's semantic structure, from headings to tables and citations.
import { cellGrid, type TypstGridKind } from "./layout/index";
import { fn, named, pos, type TypstBuiltin } from "./typstBuiltin";

const SUPPLEMENT = "none | auto | content | function";
const NUMBERING = "none | str | function";
const children = (doc: string) => pos("children", "content", doc);

const listLike = (kind: "list" | "enum"): readonly ReturnType<typeof named>[] => [
  named("tight", "bool", "true", "Whether the items are spaced like a paragraph's lines rather than like paragraphs."),
  named("indent", "length", "0pt", "The indent of each item."),
  named("body-indent", "length", "0.5em", `The space between the ${kind === "list" ? "marker" : "number"} and the body of each item.`),
  named("spacing", "auto | length", "auto", "The spacing between items; `auto` uses paragraph leading for tight lists and paragraph spacing otherwise."),
];

const TABLE: TypstGridKind = { name: "table", inset: "0% + 5pt", stroke: "1pt + black" };

export const MODEL: readonly TypstBuiltin[] = [
  fn("heading", "A section heading, as written with `=` signs.", [
    pos("body", "content", "The heading's title."),
    named("level", "auto | int", "auto", "The absolute nesting depth; `auto` computes it from `offset` and `depth`."),
    named("depth", "int", "1", "The relative nesting depth, as given by the number of `=` signs."),
    named("offset", "int", "0", "The starting offset of each heading's level."),
    named("numbering", NUMBERING, "none", "How to number the heading, such as `\"1.a)\"`."),
    named("supplement", SUPPLEMENT, "auto", "A supplement for references to the heading; `auto` uses a localized word."),
    named("outlined", "bool", "true", "Whether the heading appears in the outline."),
    named("bookmarked", "auto | bool", "auto", "Whether the heading appears as a bookmark in the PDF; `auto` follows `outlined`."),
    named("hanging-indent", "auto | length", "auto", "The indent of all but the first line of a heading; `auto` aligns them with the title after the number."),
  ], "content"),
  fn("par", "A logical subdivision of textual content, separated by a blank line.", [
    pos("body", "content", "The paragraph's contents."),
    named("leading", "length", "0.65em", "The spacing between lines."),
    named("spacing", "length", "1.2em", "The spacing between paragraphs."),
    named("justify", "bool", "false", "Whether to justify text in its line."),
    named("linebreaks", "auto | str", "auto", "How to break lines: `\"simple\"` or `\"optimized\"`; `auto` optimizes only justified text."),
    named("first-line-indent", "length | dictionary", "(amount: 0pt, all: false)", "The indent of the first line of a paragraph, optionally of every paragraph."),
    named("hanging-indent", "length", "0pt", "The indent of all but the first line of a paragraph."),
  ], "content"),
  fn("parbreak", "A paragraph break, as written with a blank line.", [], "content"),
  fn("list", "A bullet list, as written with `-` items.", [
    children("The list's items."),
    named("marker", "content | array | function", "([•], [‣], [–])", "The marker of each item, or one marker per nesting level."),
    ...listLike("list"),
  ], "content", [
    fn("item", "A bullet list item.", [pos("body", "content", "The item's body.")], "content"),
  ]),
  fn("enum", "A numbered list, as written with `+` or `1.` items.", [
    children("The enumeration's items."),
    named("numbering", "str | function", "\"1.\"", "How to number the items, such as `\"a)\"`."),
    named("start", "auto | int", "auto", "Which number to start with; `auto` starts at 1, or at the total for a reversed list."),
    named("full", "bool", "false", "Whether to display the numbers of all parent items as well."),
    named("reversed", "bool", "false", "Whether to number the items in reverse order."),
    named("number-align", "alignment", "end + top", "How to align the numbers."),
    ...listLike("enum"),
  ], "content", [
    fn("item", "A numbered list item.", [
      pos("number", "auto | int", "The item's number; `auto` continues from the previous item.", "auto"),
      pos("body", "content", "The item's body."),
    ], "content"),
  ]),
  fn("terms", "A list of terms and their descriptions, as written with `/ Term: description`.", [
    children("The term list's items."),
    named("tight", "bool", "true", "Whether the items are spaced like a paragraph's lines rather than like paragraphs."),
    named("separator", "content", "h(0.6em, weak: true)", "The separator between a term and its description."),
    named("indent", "length", "0pt", "The indent of each item."),
    named("hanging-indent", "length", "2em", "The indent of every line of an item but the first."),
    named("spacing", "auto | length", "auto", "The spacing between items."),
  ], "content", [
    fn("item", "A term list item.", [
      pos("term", "content", "The term described by the item."),
      pos("description", "content", "The description of the term."),
    ], "content"),
  ]),
  fn("figure", "A figure with an optional caption, numbered and referenceable by kind (image, table, raw).", [
    pos("body", "content", "The content of the figure, often an image."),
    named("placement", "none | auto | alignment", "none", "Where to float the figure: `top`, `bottom` or `auto`; `none` keeps it in the flow."),
    named("scope", "str", "\"column\"", "Relative to which container a floating figure is placed: `\"column\"` or `\"parent\"`."),
    named("caption", "none | content", "none", "The figure's caption."),
    named("kind", "auto | str | function", "auto", "The kind of figure, used for numbering and selectors; `auto` infers it from the body."),
    named("supplement", SUPPLEMENT, "auto", "The word in front of the figure number, such as \"Figure\"."),
    named("numbering", NUMBERING, "\"1\"", "How to number the figure."),
    named("gap", "length", "0.65em", "The space between the body and the caption."),
    named("outlined", "bool", "true", "Whether the figure appears in an outline of figures."),
  ], "content", [
    fn("caption", "The caption of a figure, usually customized with set and show rules.", [
      pos("body", "content", "The caption's text."),
      named("position", "alignment", "bottom", "The caption's position relative to the body: `top` or `bottom`."),
      named("separator", "auto | content", "auto", "The separator between the number and the caption text."),
    ], "content"),
  ]),
  ...cellGrid(TABLE, "A table of items in rows and columns, with semantic header, footer and cells."),
  fn("link", "Links to a URL or a location in the document.", [
    pos("dest", "str | label | location | dictionary", "The destination: a URL, a label, a location or a page-and-position dictionary."),
    pos("body", "content", "The content to show for the link; it can be left out for a URL, which is then shown."),
  ], "content"),
  fn("ref", "A reference to a label or bibliography entry, as written with `@label`.", [
    pos("target", "label", "The label to refer to."),
    named("supplement", SUPPLEMENT, "auto", "A supplement shown in front of the number."),
    named("form", "str", "\"normal\"", "The kind of reference: `\"normal\"` or `\"page\"`."),
  ], "content"),
  fn("cite", "Cites an entry of the bibliography.", [
    pos("key", "label", "The citation key of the entry."),
    named("supplement", "none | content", "none", "A supplement such as a page number."),
    named("form", "none | str", "\"normal\"", "The citation form: `\"normal\"`, `\"prose\"`, `\"full\"`, `\"author\"` or `\"year\"`."),
    named("style", "auto | str | bytes", "auto", "The citation style; `auto` uses the bibliography's style."),
  ], "content"),
  fn("bibliography", "A bibliography from BibLaTeX or Hayagriva files.", [
    pos("sources", "str | bytes | array", "The path of a bibliography file, its raw bytes, or a list of either."),
    named("title", "none | auto | content", "auto", "The title of the bibliography; `auto` uses a localized title."),
    named("full", "bool", "false", "Whether to include all entries, not only the cited ones."),
    named("style", "str | bytes", "\"ieee\"", "The bibliography style: a built-in style name or a CSL file."),
  ], "content"),
  fn("footnote", "A footnote at the bottom of the page.", [
    pos("body", "content | label", "The footnote's content, or the label of another footnote to refer to it."),
    named("numbering", "str | function", "\"1\"", "How to number footnotes."),
  ], "content"),
  fn("quote", "Displays a quote, inline or as a block, with an optional attribution.", [
    pos("body", "content", "The quoted text."),
    named("block", "bool", "false", "Whether the quote is a separate block."),
    named("quotes", "auto | bool", "auto", "Whether to wrap the quote in quotation marks; `auto` adds them to inline quotes."),
    named("attribution", "none | label | content", "none", "The quote's source, or a bibliography label to cite."),
  ], "content"),
  fn("outline", "A table of contents, of figures or of other elements.", [
    named("title", "none | auto | content", "auto", "The outline's title; `auto` uses a localized title."),
    named("target", "label | selector | location | function", "heading", "Which elements to list."),
    named("depth", "none | int", "none", "The maximum heading level to include."),
    named("indent", "auto | relative | function", "auto", "How to indent nested entries."),
  ], "content"),
  fn("document", "The document's metadata, set at the top of the file with `#set document(..)`.", [
    named("title", "none | content", "none", "The document's title, embedded in the PDF."),
    named("author", "str | array", "()", "The document's authors."),
    named("description", "none | content", "none", "The document's description."),
    named("keywords", "str | array", "()", "The document's keywords."),
    named("date", "none | auto | datetime", "auto", "The document's creation date; `auto` uses the current date when the document is built."),
  ], "content"),
  fn("numbering", "Applies a numbering pattern such as `\"1.a\"` or a function to a sequence of numbers.", [
    pos("numbering", "str | function", "The numbering pattern or function."),
    pos("numbers", "int", "The numbers to format, as any number of arguments."),
  ], "any"),
  fn("emph", "Emphasizes content by toggling italics, as written with `_underscores_`.", [
    pos("body", "content", "The content to emphasize."),
  ], "content"),
  fn("strong", "Strongly emphasizes content by setting it in bold, as written with `*stars*`.", [
    pos("body", "content", "The content to emphasize."),
    named("delta", "int", "300", "The font weight to add."),
  ], "content"),
];
