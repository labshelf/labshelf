/**
 * Handlers that write the paper's sidecar from the reader: annotation create, update and delete, and the reading position.
 */
import type { WebviewToHost } from "../protocol.js";
import { normalizeReadingState } from "../sidecar/index.js";
import { READER_LOG_MODULE, type HostContext, type MessageHandlers } from "./hostContext.js";

type StoreResult<T> = { ok: true; value: T } | { ok: false };

/** A rejected annotation write becomes a specific notice, and the reader keeps the list it has. */
async function writeAnnotation<T>(
  ctx: HostContext,
  verb: "create" | "update" | "delete",
  command: WebviewToHost["command"],
  write: () => Promise<T>,
): Promise<StoreResult<T>> {
  try {
    return { ok: true, value: await write() };
  } catch (err) {
    void ctx.ports.logger.error(READER_LOG_MODULE, err, { paperId: ctx.ports.paper.id, command });
    ctx.ports.notify(`Failed to ${verb} annotation: ${err instanceof Error ? err.message : String(err)}`, "error");
    return { ok: false };
  }
}

async function pushStoredAnnotations(ctx: HostContext): Promise<void> {
  ctx.pushAnnotations(await ctx.ports.store.getAnnotations(ctx.ports.paper.id), true);
}

export const annotationHandlers: Pick<
  MessageHandlers,
  "createAnnotation" | "updateAnnotation" | "deleteAnnotation" | "saveReadingState"
> = {
  createAnnotation: async (ctx, msg) => {
    const { store, paper } = ctx.ports;
    const result = await writeAnnotation(ctx, "create", msg.command, () => msg.type === "highlight"
      // The reader sends null for a highlight without a stored rectangle.
      ? store.addHighlight(paper.id, msg.pageNumber, msg.content, msg.color ?? "yellow", msg.position ?? undefined)
      : store.addNote(paper.id, msg.pageNumber, msg.content));
    if (!result.ok) { return; }
    ctx.ports.activity?.annotated(msg.pageNumber);
    await pushStoredAnnotations(ctx);
    ctx.ports.sidecarChanged?.({ kind: "annotationCreated", annotation: result.value });
  },

  updateAnnotation: async (ctx, msg) => {
    const { store, paper } = ctx.ports;
    const result = await writeAnnotation(ctx, "update", msg.command, () => store.updateAnnotation(paper.id, msg.id, msg.content));
    if (!result.ok) { return; }
    await pushStoredAnnotations(ctx);
    ctx.ports.sidecarChanged?.({ kind: "annotationUpdated", annotation: result.value });
  },

  deleteAnnotation: async (ctx, msg) => {
    const { store, paper } = ctx.ports;
    const result = await writeAnnotation(ctx, "delete", msg.command, () => store.deleteAnnotation(paper.id, msg.id));
    if (!result.ok) { return; }
    await pushStoredAnnotations(ctx);
    if (result.value) { ctx.ports.sidecarChanged?.({ kind: "annotationDeleted", annotationId: msg.id }); }
  },

  // Not a sidecar change for the host: the position rides along with the next sync.
  saveReadingState: async (ctx, msg) => {
    const state = normalizeReadingState(msg.state);
    if (state) { await ctx.ports.store.setReadingState(ctx.ports.paper.id, state); }
  },
};
