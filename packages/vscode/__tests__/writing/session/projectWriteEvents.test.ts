// Verifies editor saves wait for ancestry records before the write and commit the final participant text.
import * as vscode from 'vscode';
import { registerProjectSaveEvents } from '../../../src/writing/session';
import { fakeLogger } from '../../support/writingFixtures';

it('records before saving and completes with the final saved text', async () => {
  const will = vscode.workspace.onWillSaveTextDocument as jest.Mock;
  const did = vscode.workspace.onDidSaveTextDocument as jest.Mock;
  const saves = { fs: {} as never, beforeSave: jest.fn(async () => {}), afterSave: jest.fn(async () => {}) };
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
  registerProjectSaveEvents(context, saves, fakeLogger());
  let text = 'draft';
  const document = { uri: vscode.Uri.file('/project/main.tex'), getText: () => text };
  const waitUntil = jest.fn();
  will.mock.calls.at(-1)![0]({ document, waitUntil });
  expect(waitUntil).toHaveBeenCalledTimes(1);
  await waitUntil.mock.calls[0]![0];
  expect(saves.beforeSave).toHaveBeenCalledWith('/project/main.tex', 'draft');
  text = 'formatted';
  did.mock.calls.at(-1)![0](document);
  await Promise.resolve();
  expect(saves.afterSave).toHaveBeenCalledWith('/project/main.tex', 'formatted');
  for (const disposable of context.subscriptions) disposable.dispose();
});
