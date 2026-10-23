// Parses a qmd item file into loose text and items without losing or changing a byte.
// CONTRACT: documents/contracts/qmd-items.md#items
import { parseAnchor } from "../anchors/index.js";
import { attributeValue, parseDivOpener } from "./divAttributes.js";
import { topLevelDivs } from "./fencedDivs.js";
import { ITEM_CLASS, type ItemFile, type ItemSegment, type Segment } from "./itemFile.js";
import { lineContent, splitLines } from "./lines.js";

const BOM = "\uFEFF";

export function parseItemFile(text: string): ItemFile {
  // A byte order mark is kept as loose text, so it neither hides the first item nor disappears on write.
  const bom = text.startsWith(BOM) ? BOM : "";
  const lines = splitLines(text.slice(bom.length));
  const segments: Segment[] = [];
  let loose = bom;
  let next = 0;
  for (const div of topLevelDivs(lines)) {
    const item = readItem(lines, div.open, div.close);
    if (!item) { continue; }
    loose += lines.slice(next, div.open).join("");
    if (loose !== "") { segments.push({ kind: "loose", text: loose }); }
    loose = "";
    segments.push(item);
    next = div.close + 1;
  }
  loose += lines.slice(next).join("");
  if (loose !== "") { segments.push({ kind: "loose", text: loose }); }
  return { segments };
}

/** Reads the item whose fence spans `open`..`close`, or undefined when the div is not an item. */
function readItem(lines: readonly string[], open: number, close: number): ItemSegment | undefined {
  const fence = lines[open]!;
  const attributes = parseDivOpener(lineContent(fence));
  if (!attributes?.id || !attributes.classes.includes(ITEM_CLASS)) { return undefined; }
  const author = attributeValue(attributes, "author");
  const created = attributeValue(attributes, "created");
  return {
    kind: "item",
    id: attributes.id,
    anchor: parseAnchor(attributeValue(attributes, "anchor")),
    ...(author === undefined ? {} : { author }),
    ...(created === undefined ? {} : { created }),
    classes: attributes.classes,
    attrs: attributes.pairs,
    fence,
    body: lines.slice(open + 1, close).join(""),
    close: lines[close]!,
  };
}
