/** Records identifiers a lookup revealed on the context, never overwriting one the context already had. */
import type { ResolveContext } from "../../types.js";

export function learnIds(ctx: ResolveContext, found: { pmcid?: string | undefined; arxivId?: string | undefined }): void {
  if (!ctx.pmcid && found.pmcid) ctx.pmcid = found.pmcid;
  if (!ctx.arxivId && found.arxivId) ctx.arxivId = found.arxivId;
}
