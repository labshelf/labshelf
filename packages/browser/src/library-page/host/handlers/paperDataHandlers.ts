/**
 * Answers the detail pane's request for a paper's annotations, reading position and PDF, and saves a paper's
 * annotations as a Markdown file.
 */
import { formatAnnotationsMarkdown } from "@labshelf/core";
import { downloadTextFile } from "../../../platform";
import type { HostContext } from "../hostContext";

export async function sendDetails(ctx: HostContext, id: string): Promise<void> {
  const [paper] = ctx.papers([id]);
  if (!paper) return;
  ctx.endpoint.post({ type: "details", id, details: await ctx.sidecars.details(paper) });
}

export async function exportAnnotations(ctx: HostContext, id: string): Promise<void> {
  const [paper] = ctx.papers([id]);
  if (!paper) return;
  const { annotations } = await ctx.sidecars.details(paper);
  if (annotations.length === 0) { ctx.notice("info", "This paper has no annotations to export."); return; }
  await downloadTextFile(`${paper.citeKey}-annotations.md`, formatAnnotationsMarkdown(paper, annotations), "text/markdown");
}
