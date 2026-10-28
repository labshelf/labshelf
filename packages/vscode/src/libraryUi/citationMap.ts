/**
 * Builds the citation map for the list UI and imports a missing work by its DOI, answering with the map's own messages,
 * and gives the list panel the OpenAlex ports behind them.
 */
import * as vscode from 'vscode';
import { buildCitationMap, createCitationMapView, formatError, type CitationMapView, type ImportOutcome } from '@labshelf/core';
import { addTextLayersOfAdded, type ActiveServices } from '../command/index.js';
import type { ListHostContext } from './handlers.js';

/** The module name the library UI's handlers log under. */
export const LOG_MODULE = 'libraryUi';

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

export interface CitationMapPorts {
  /** Builds the map; the first build fetches one OpenAlex request per paper with a DOI. */
  buildCitationMap(): Promise<CitationMapView>;
  importByDoi(doi: string): Promise<ImportOutcome>;
}

export function createCitationMapPorts(services: ActiveServices): CitationMapPorts {
  return {
    async buildCitationMap() {
      const papers = await services.paperService.listPapers();
      const map = await buildCitationMap(
        { registry: { fetch: globalThis.fetch, logger: services.logger }, fs: services.fileSystem, cacheDir: services.citationCacheDir, logger: services.logger },
        papers,
      );
      return createCitationMapView(map, papers);
    },
    async importByDoi(doi) {
      const outcome = await services.importer.importFromNetwork(doi);
      addTextLayersOfAdded(services, [outcome]);
      return outcome;
    },
  };
}
