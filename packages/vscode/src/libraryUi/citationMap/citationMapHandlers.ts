/** Builds the citation map for the list UI and imports a missing work by its DOI, answering with the map's own messages. */
import * as vscode from 'vscode';
import { formatError, type ImportOutcome } from '@labshelf/core';
import { LOG_MODULE, type ListHostContext } from '../host/index.js';

/** Posts the map being built, then the map or why it failed. */
export async function showCitationMap(ctx: ListHostContext): Promise<void> {
  await ctx.post({ type: 'citationMap.show', state: { status: 'loading' } });
  try {
    const map = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'LabShelf: building the citation map…' },
      () => ctx.deps.citationMap.buildCitationMap(),
    );
    await ctx.post({ type: 'citationMap.show', state: { status: 'ready', map } });
  } catch (error) {
    const message = formatError(error);
    await ctx.deps.logger.log('ERROR', LOG_MODULE, 'Building the citation map failed', { message });
    await ctx.post({ type: 'citationMap.show', state: { status: 'failed', message } });
  }
}

async function importOutcome(ctx: ListHostContext, doi: string): Promise<ImportOutcome> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'LabShelf', cancellable: false },
    async (progress) => {
      progress.report({ message: 'Looking the paper up and downloading its PDF…' });
      return ctx.deps.citationMap.importByDoi(doi);
    },
  );
}

/** Imports the work; the library's own change events send the refreshed snapshot. */
export async function importCitationWork(ctx: ListHostContext, workId: string, doi: string): Promise<void> {
  try {
    const outcome = await importOutcome(ctx, doi);
    if (outcome.status === 'added') {
      ctx.notice('ok', `Imported "${outcome.record.title}"`);
    } else if (outcome.status === 'duplicate') {
      ctx.notice('info', 'This paper is already in your library');
    } else {
      throw new Error(outcome.status === 'failed' ? outcome.error : 'the paper could not be imported');
    }
    await ctx.post({ type: 'citationMap.imported', workId });
  } catch (error) {
    const message = formatError(error);
    await ctx.deps.logger.log('ERROR', LOG_MODULE, 'Importing a missing work failed', { workId, doi, message });
    ctx.notice('error', `Could not import ${doi} — ${message}`);
    await ctx.post({ type: 'citationMap.importFailed', workId });
  }
}
