// Sends a selection to a .qmd target: picks the item id, builds the body (quote, equation, figure or item, with a back-link) and hands it to the writer of the target kind.
// CONTRACT: documents/contracts/qmd-items.md#format
import { formatPaperLink } from "../library/index.js";
import type { ILogger } from "../ports/index.js";

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

export type SendTarget =
  | { kind: "projectNote"; projectId: string; path: string }
  | { kind: "spaceNote"; spaceId: string; path: string }
  | { kind: "discussion"; spaceId: string; path: string };

/** `blob.path` is relative to the folder holding the target file. */
export interface SendExtra { itemId?: string; author?: string; blob?: { path: string; bytes: Uint8Array } }

/** Writers write the blob first and append the item only after the blob write succeeded. */
export interface ISendTargetWriter { append(target: SendTarget, body: string, extra?: SendExtra): Promise<void> }

export interface SendRequest { target: SendTarget; payload: SendPayload; sender?: string }

export function sendTo(
  writers: Partial<Record<SendTarget["kind"], ISendTargetWriter>>,
  deps: { logger: ILogger; newItemId: () => string },
): (request: SendRequest) => Promise<{ itemId: string }> {
  return async ({ target, payload, sender }) => {
    const writer = writers[target.kind];
    if (!writer) {
      const error = new Error(`No writer registered for send target kind "${target.kind}"`);
      void deps.logger.error("sendTo", error, { target });
      throw error;
    }
    const itemId = deps.newItemId();
    const body = createSendBody(payload, itemId);
    const extra: SendExtra = {
      itemId,
      ...(sender === undefined ? {} : { author: sender }),
      ...(payload.kind === "figure" ? { blob: { path: sendAssetPath(itemId), bytes: payload.image } } : {}),
    };
    try {
      await writer.append(target, body, extra);
    } catch (error) {
      void deps.logger.error("sendTo", error, { target });
      throw error;
    }
    return { itemId };
  };
}
