// Builds the item body that "Send to…" appends: the selection, then a back-link to its paper page or source item.
// CONTRACT: documents/contracts/qmd-items.md#format
import { formatPaperLink } from "../../library/record.js";

export type SendPayload =
  | { kind: "quote"; key: string; page: number; text: string }
  | { kind: "figure"; key: string; page: number; image: Uint8Array; mime: string }
  | { kind: "equation"; key: string; page: number; latex: string }
  | { kind: "item"; sourcePath: string; itemId: string; body: string };

/** The asset path of a sent figure, relative to the folder of the target note. */
export function sendAssetPath(itemId: string): string {
  return `assets/${itemId}.png`;
}

function pageLink(key: string, page: number): string {
  return `[${key}, p. ${page}](${formatPaperLink({ citeKey: key, page })})`;
}

/** Blocks are separated by one blank line. */
export function createSendBody(payload: SendPayload, itemId: string): string {
  switch (payload.kind) {
    case "quote": {
      const quote = payload.text.split("\n").map((line) => `> ${line}`).join("\n");
      return `${quote}\n\n${pageLink(payload.key, payload.page)}`;
    }
    case "equation":
      return `$$\n${payload.latex}\n$$\n\n${pageLink(payload.key, payload.page)}`;
    case "figure":
      return `![](${sendAssetPath(itemId)})\n\n${pageLink(payload.key, payload.page)}`;
    case "item":
      return `${payload.body}\n\n[Source](${payload.sourcePath}#${payload.itemId})`;
  }
}
