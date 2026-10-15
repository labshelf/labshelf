/**
 * Does the paper work the list UI asks for: paper service changes, move, remove to the trash, the clipboard and the
 * extension commands. Every outcome the user should know about comes back as a notice.
 */
import * as vscode from 'vscode';
import { cleanTags, keptFieldNotice, moveNotice, removeNotice, type PaperStatus } from '@labshelf/core';
import { LOG_MODULE, type ListHostContext } from './hostContext.js';

export async function setStatus(ctx: ListHostContext, ids: string[], status: PaperStatus): Promise<void> {
  const failed: string[] = [];
  for (const id of ids) {
    if (!(await ctx.deps.paperService.updatePaperStatus(id, status))) { failed.push(id); }
  }
  if (failed.length) { ctx.notice('error', keptFieldNotice('status', failed.length, 'not found in the library')); }
}

export async function setTags(ctx: ListHostContext, ids: string[], add: string[], remove: string[]): Promise<void> {
  const outcome = await ctx.deps.paperService.editTags(ids, cleanTags(add), cleanTags(remove));
  const first = outcome.failed[0];
  if (first) { ctx.notice('error', keptFieldNotice('tags', outcome.failed.length, first.error)); }
}

export async function setNote(ctx: ListHostContext, id: string, note: string): Promise<void> {
  if (!(await ctx.deps.paperService.updatePaperFields(id, { note }))) { ctx.notice('error', 'The note could not be saved — the paper is not in the library'); }
}

async function titleLookup(ctx: ListHostContext, ids: string[]): Promise<(id: string) => string> {
  const papers = await ctx.papers(ids);
  return (id) => papers.find((p) => p.id === id)?.title ?? id;
}

export async function movePapers(ctx: ListHostContext, ids: string[], targetDir: string): Promise<void> {
  const result = await ctx.deps.paperService.movePapers(ids, targetDir);
  const where = targetDir === ctx.paths()?.root ? undefined : ctx.deps.pathOps.basename(targetDir);
  const notice = moveNotice(result.done.length, result.failed, where, await titleLookup(ctx, ids));
  if (notice) { ctx.notice(notice.kind, notice.text); }
}

export async function removePapers(ctx: ListHostContext, ids: string[]): Promise<void> {
  const papers = await ctx.papers(ids);
  const outcome = await ctx.deps.paperService.trashPapers(papers.map((p) => p.id));
  const titleOf = (id: string): string => papers.find((p) => p.id === id)?.title ?? id;
  const notice = removeNotice(outcome.done, outcome.failed, titleOf);
  if (notice) { ctx.notice(notice.kind, notice.text); }
}

export async function writeClipboard(ctx: ListHostContext, text: string, label: string | undefined): Promise<void> {
  if (!text) { return; }
  await vscode.env.clipboard.writeText(text);
  ctx.notice('ok', `Copied ${label ?? 'text'}`);
}

export async function revealPaper(ctx: ListHostContext, id: string): Promise<void> {
  const [paper] = await ctx.papers([id]);
  if (paper) { await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(paper.path)); }
}

/** Runs an extension command for the UI and logs what it asked for. */
export async function runCommand(ctx: ListHostContext, command: string, ...args: unknown[]): Promise<void> {
  await ctx.deps.logger.log('INFO', LOG_MODULE, 'List runs a command', { command });
  await vscode.commands.executeCommand(command, ...args);
}
