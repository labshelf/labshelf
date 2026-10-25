// Records editor save ancestry before VS Code writes project documents.
import * as vscode from 'vscode';
import { formatError, type ILogger, type ProjectWriteTracking } from '@labshelf/core';

export function registerProjectWriteEvents(context: vscode.ExtensionContext, saves: ProjectWriteTracking, logger: ILogger): void {
  const fail = async (file: string, action: string, error: unknown): Promise<void> => {
    await logger.error('writing-merge', error, { file, action });
    void vscode.window.showErrorMessage(`Could not record project save for ${file}: ${formatError(error)}`);
  };
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument(event => {
      if (event.document.uri.scheme !== 'file') return;
      const file = event.document.uri.fsPath;
      event.waitUntil(saves.beforeSave(file, event.document.getText()).then(() => []).catch(async error => {
        await fail(file, 'record project save before write', error);
        throw error;
      }));
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      if (document.uri.scheme !== 'file') return;
      void saves.afterSave(document.uri.fsPath, document.getText()).catch(error => fail(document.uri.fsPath, 'record saved project text', error));
    }),
  );
}
