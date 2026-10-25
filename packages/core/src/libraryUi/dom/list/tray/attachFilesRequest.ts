// Asks the host for a paper's files whenever a paper opens; returns the function that stops asking.
import type { UiContext } from "../../uiContext.js";

export function attachFilesRequest(ctx: UiContext): () => void {
  return ctx.store.select((s) => s.open, (id) => { if (id) ctx.transport.post({ type: "paper.files", id }); });
}
