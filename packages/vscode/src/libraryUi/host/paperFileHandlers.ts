/** Answers the file-tray messages of the list UI: listing and describing a paper's files, and opening, revealing or copying one. */
import * as vscode from 'vscode';
import { formatError, type PaperFilesState, type UiToHost } from '@labshelf/core';
import { LOG_MODULE, type ListHostContext } from './hostContext.js';

const NO_PORT: PaperFilesState = { status: 'failed', message: 'This window cannot list paper files' };

// The webview is untrusted; parseUiMessage already checks the name, and this keeps the path inside the paper folder
// even if that guard changes.
const isOneSegment = (name: string): boolean => name !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name);

async function sendFiles(ctx: ListHostContext, id: string): Promise<void> {
  const port = ctx.deps.paperFiles;
  if (!port) {
    await ctx.deps.logger.log('WARN', LOG_MODULE, 'List asked for paper files without a file port', { id });
    await ctx.post({ type: 'files', id, state: NO_PORT });
    return;
  }
  let state: PaperFilesState;
  try {
    state = await port.list(id);
  } catch (err) {
    const message = formatError(err);
    await ctx.deps.logger.log('ERROR', LOG_MODULE, 'Listing paper files failed', { id, message });
    state = { status: 'failed', message };
  }
  await ctx.post({ type: 'files', id, state });
}

async function describeFile(ctx: ListHostContext, id: string, name: string, description: string): Promise<void> {
  const port = ctx.deps.paperFiles;
  if (!port) { await sendFiles(ctx, id); return; }
  const state = await port.describe(id, name, description);
  if (!state) { ctx.notice('error', `Could not describe "${name}" — it is not a file of this paper`); return; }
  await ctx.post({ type: 'files', id, state });
}

// The absolute path of one entry of a paper folder, or undefined (with a notice for a bad name) when it cannot be one.
async function entryUri(ctx: ListHostContext, id: string, name: string): Promise<vscode.Uri | undefined> {
  if (!isOneSegment(name)) {
    await ctx.deps.logger.log('WARN', LOG_MODULE, 'List sent a file name that leaves the paper folder', { id, name });
    ctx.notice('error', `"${name}" is not a file of this paper`);
    return undefined;
  }
  const [paper] = await ctx.papers([id]);
  return paper && vscode.Uri.file(ctx.deps.pathOps.join(paper.path, name));
}

async function openFile(ctx: ListHostContext, uri: vscode.Uri): Promise<void> {
  const stat = await vscode.workspace.fs.stat(uri);
  if ((stat.type & vscode.FileType.Directory) !== 0) {
    await vscode.commands.executeCommand('revealInExplorer', uri);
    return;
  }
  await vscode.commands.executeCommand('vscode.open', uri, vscode.ViewColumn.Beside);
}

async function onEntryMessage(ctx: ListHostContext, m: UiToHost & { name: string; id: string }): Promise<void> {
  const uri = await entryUri(ctx, m.id, m.name);
  if (!uri) { return; }
  if (m.type === 'paper.openFile') { await openFile(ctx, uri); }
  if (m.type === 'paper.revealFile') { await vscode.commands.executeCommand('revealFileInOS', uri); }
  if (m.type === 'paper.copyFilePath') {
    await vscode.env.clipboard.writeText(uri.fsPath);
    ctx.notice('ok', `Copied the path of ${m.name}`);
  }
}

/** @returns whether the message was a file-tray message, which it then handled */
export async function onPaperFileMessage(ctx: ListHostContext, m: UiToHost): Promise<boolean> {
  switch (m.type) {
    case 'paper.files': await sendFiles(ctx, m.id); return true;
    case 'paper.describeFile': await describeFile(ctx, m.id, m.name, m.description); return true;
    case 'paper.openFile':
    case 'paper.revealFile':
    case 'paper.copyFilePath': await onEntryMessage(ctx, m); return true;
    default: return false;
  }
}
