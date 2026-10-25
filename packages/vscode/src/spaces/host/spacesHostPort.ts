// Binds Spaces page actions to VS Code dialogs and commands.
import * as vscode from 'vscode';
import { buildSpaceProjectInfos, type ChecklistReader, type ILogger, type ProjectLibraryPort, type SpacesHostPort } from '@labshelf/core';
import type { ActiveServices } from '../../command/index.js';

export interface SpacesPortOptions {
  services: ActiveServices;
  projectLibrary: () => ProjectLibraryPort;
  readChecklist: ChecklistReader;
  projectId: (hostId: string) => string | undefined;
  logger: ILogger;
  selectPaper: (id: string) => Promise<void>;
}

export function createSpacesHostPort(options: SpacesPortOptions): SpacesHostPort {
  const { services, projectLibrary, readChecklist, logger } = options;
  return {
    library: () => services.library.snapshot.papers,
    onLibraryChange: (listener) => services.library.onChange(listener),
    projects: async () => {
      const rows = await projectLibrary().list();
      const infos = await buildSpaceProjectInfos(rows, readChecklist, logger);
      return infos.flatMap((info) => {
        const id = options.projectId(info.projectId);
        return id ? [{ ...info, projectId: id }] : [];
      });
    },
    onProjectsChange: (listener) => projectLibrary().onDidChange(listener),
    openPaper: async (id) => { await vscode.commands.executeCommand('labshelf.openPaperPdf', id); },
    selectPaper: options.selectPaper,
    openProject: async (id) => {
      const row = (await projectLibrary().list()).find((row) => options.projectId(row.id) === id);
      if (!row) throw new Error(`Project ${id} is unavailable`);
      await projectLibrary().open(row.id);
    },
    openSpace: async (id, tab) => { await vscode.commands.executeCommand('labshelf.spaces.open', id, tab); },
    openCatalog: async () => { await vscode.commands.executeCommand('labshelf.spaces.all'); },
    saveFile: (name, text) => saveFile(name, text, logger),
  };
}

async function saveFile(name: string, text: string, logger: ILogger): Promise<void> {
  try {
    const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(name), saveLabel: 'Save' });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
    void logger.log('INFO', 'spaces', 'Space export saved', { path: target.toString() });
  } catch (error) {
    void logger.error('spaces', error, { action: 'save export', name });
    throw error;
  }
}
