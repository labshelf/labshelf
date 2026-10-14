/**
 * The paper work the list UI asks for: paper service changes, move, remove to the trash, the clipboard and the
 * extension commands. Every outcome the user should know about comes back as a notice.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ROOT_LABEL, type PaperStatus } from '@labshelf/core';
import { LOG_MODULE, papersLabel, type ListHostContext } from './hostContext.js';

export async function setStatus(ctx: ListHostContext, ids: string[], status: PaperStatus): Promise<void> {
  const failed: string[] = [];
  for (const id of ids) {
    if (!(await ctx.deps.paperService.updatePaperStatus(id, status))) { failed.push(id); }
  }
  if (failed.length) { ctx.notice('error', `${papersLabel(failed.length)} kept their status — not found in the library`); }
}

export async function setTags(ctx: ListHostContext, ids: string[], add: string[], remove: string[]): Promise<void> {
  const clean = (tags: string[]): string[] => tags.map((t) => t.trim()).filter(Boolean);
  const outcome = await ctx.deps.paperService.editTags(ids, clean(add), clean(remove));
  const first = outcome.failed[0];
  if (first) { ctx.notice('error', `${papersLabel(outcome.failed.length)} kept their tags — ${first.error}`); }
}

export async function setNote(ctx: ListHostContext, id: string, note: string): Promise<void> {
  if (!(await ctx.deps.paperService.updatePaperFields(id, { note }))) { ctx.notice('error', 'The note could not be saved — the paper is not in the library'); }
}

export async function movePapers(ctx: ListHostContext, ids: string[], targetDir: string): Promise<void> {
  const result = await ctx.deps.paperService.movePapers(ids, targetDir);
  const first = result.failed[0];
  if (first) {
    ctx.notice('error', `${result.done.length} moved, ${result.failed.length} failed — ${first.error}`);
  } else if (result.done.length > 0) {
    const where = targetDir === ctx.paths()?.root ? ROOT_LABEL : path.basename(targetDir);
    ctx.notice('ok', `${papersLabel(result.done.length)} moved to ${where}`);
  }
}

export async function removePapers(ctx: ListHostContext, ids: string[]): Promise<void> {
  const papers = await ctx.papers(ids);
  const outcome = await ctx.deps.paperService.trashPapers(papers.map((p) => p.id));
  const first = outcome.failed[0];
  if (first) {
    const title = papers.find((p) => p.id === first.id)?.title ?? first.id;
    const others = outcome.failed.length > 1 ? ` (and ${outcome.failed.length - 1} more)` : '';
    ctx.notice('error', `Could not move "${title}"${others} to the trash — ${first.error}`);
  } else if (outcome.done.length > 0) {
    ctx.notice('ok', outcome.done.length === 1 ? `Removed "${papers[0]?.title ?? ''}"` : `Removed ${papersLabel(outcome.done.length)}`);
  }
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
