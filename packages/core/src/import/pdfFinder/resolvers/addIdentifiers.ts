/** Records identifiers a lookup revealed on the context, never overwriting one the context already had. */
import type { ResolveContext } from "../pdfResolver.js";

export function addIdentifiers(ctx: ResolveContext, found: { pmcid?: string | undefined; arxivId?: string | undefined }): void {
  if (!ctx.pmcid && found.pmcid) ctx.pmcid = found.pmcid;
  if (!ctx.arxivId && found.arxivId) ctx.arxivId = found.arxivId;
}
