/**
 * Answers the detail pane's requests for per-paper data: annotations, the reading position and the PDF on this
 * device, and papers with similar content from the AI index.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PDF_FILE, paperDetailsOf, paperFiles, type PaperDetails, type SidecarSummarySource, type SimilarPaper } from '@labshelf/core';
import { LOG_MODULE, type ListHostContext } from './hostContext.js';

async function pdfOnDevice(ctx: ListHostContext, paperPath: string, hasPdf: boolean | undefined): Promise<PaperDetails['pdf']> {
  if (hasPdf === false) { return null; }
  const file = paperFiles(paperPath, path.join).pdf;
  try {
    const { size } = await vscode.workspace.fs.stat(vscode.Uri.file(file));
    const root = ctx.paths()?.root;
    return { size, relPath: root ? path.relative(root, file) : PDF_FILE };
  } catch {
    // Not synced to this device yet; the pane says so.
    return null;
  }
}

export async function sendDetails(ctx: ListHostContext, id: string): Promise<void> {
  const [paper] = await ctx.papers([id]);
  if (!paper) { return; }
  let sidecar: SidecarSummarySource = { annotations: [] };
  if (ctx.deps.loadSidecar) {
    try {
      sidecar = await ctx.deps.loadSidecar(id);
    } catch (error) {
      await ctx.deps.logger.log('WARN', LOG_MODULE, 'Sidecar could not be read; showing no annotations', { paperId: id, message: String(error) });
    }
  }
  const details = paperDetailsOf(sidecar, await pdfOnDevice(ctx, paper.path, paper.hasPdf));
  await ctx.post({ type: 'details', id, details });
}

export async function sendSimilar(ctx: ListHostContext, id: string): Promise<void> {
  const find = ctx.deps.findSimilar;
  const [paper] = await ctx.papers([id]);
  let items: SimilarPaper[] = [];
  if (find && paper) {
    try {
      items = (await find(paper)).filter((item) => item.paperId !== id);
    } catch (error) {
      // The AI index is optional; Related still shows the metadata groups.
      await ctx.deps.logger.log('WARN', LOG_MODULE, 'Similar papers could not be found', { paperId: id, message: String(error) });
    }
  }
  await ctx.post({ type: 'similar', id, items });
}
