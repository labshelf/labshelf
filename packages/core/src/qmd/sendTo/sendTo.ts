// Sends a selection to a .qmd target: picks the item id, builds the body and hands it to the writer of the target kind.
import type { ILogger } from "../../ports/index.js";
import { createSendBody, sendAssetPath, type SendPayload } from "./sendBody.js";

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
