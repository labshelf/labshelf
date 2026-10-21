// Tests Space sidebar refreshes across readiness, store changes and library switches.
import * as vscode from 'vscode';
import { LibrarySidebarView } from '../../../src/ui/library';
import { createLibraryEvents } from '../../../src/events';

jest.mock('../../../src/ui/list', () => ({
  libraryBundleDirectory: () => vscode.Uri.file('/bundle'), listPanelHtml: async () => '',
}));
jest.mock('../../../src/sharing', () => ({ sharingWebviews: { attach: () => ({ dispose() {} }) } }));

it('posts Space rows on ready, store changes, library changes and root changes', async () => {
  jest.useFakeTimers();
  let storeChanged: () => void = () => {};
  const rootChanged = new vscode.EventEmitter<void>();
  const events = createLibraryEvents();
  const list = jest.fn(() => [{ state: 'unreadable', id: 's', reason: 'Unreadable' }]);
  const spaces = {
    current: () => ({ store: { list, onChange: (fn: () => void) => { storeChanged = fn; return jest.fn(); } }, port: { library: () => new Map() } }),
    onDidChange: rootChanged.event,
  };
  const view = new LibrarySidebarView({
    extensionUri: vscode.Uri.file('/extension'), events, spaces, getSnapshot: () => undefined,
    projects: { rows: async () => [], onDidChange: new vscode.EventEmitter<void>().event },
    projectTrees: { snapshot: async () => null, onDidChange: new vscode.EventEmitter<void>().event },
  } as never);
  let receive: (raw: unknown) => void = () => {};
  const postMessage = jest.fn(async () => true);
  await view.resolveWebviewView({ webview: {
    onDidReceiveMessage: (fn: typeof receive) => { receive = fn; }, postMessage,
  }, onDidDispose: jest.fn() } as never);
  receive({ type: 'ready' });
  await Promise.resolve();
  expect(postMessage).toHaveBeenCalledWith({ type: 'spaces', rows: [{ id: 's', name: 's', unreadable: 'Unreadable' }] });
  for (const change of [() => storeChanged(), () => events.paperDeleted.fire({ id: 'p' }), () => rootChanged.fire()]) {
    postMessage.mockClear(); change();
    await jest.advanceTimersByTimeAsync(60);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'spaces' }));
  }
  view.dispose();
  jest.useRealTimers();
});
