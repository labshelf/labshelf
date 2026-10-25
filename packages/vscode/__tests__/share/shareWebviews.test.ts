/** The sharing webviews are served once serving starts, and a dialog request reaches the Library sidebar only after it said hello. */
import * as vscode from 'vscode';
import { SharingWebviews } from '../../src/share/shareWebviews';

function fakeWebview() {
  const listeners = new Set<(raw: unknown) => void>();
  const webview = {
    postMessage: jest.fn(async () => true),
    onDidReceiveMessage: (listener: (raw: unknown) => void) => { listeners.add(listener); return new vscode.Disposable(() => listeners.delete(listener)); },
  };
  const send = (raw: unknown) => listeners.forEach((listener) => listener(raw));
  return { webview: webview as unknown as vscode.Webview, post: webview.postMessage, send };
}

const hello = { channel: 'sharing', type: 'hello' };

describe('SharingWebviews', () => {
  it('queues an open request until the dialog webview says hello, and the latest request wins', async () => {
    const webviews = new SharingWebviews();
    const sidebar = fakeWebview();
    webviews.attach(sidebar.webview, { opensDialogs: true });
    await webviews.open({ kind: 'manageLinks' });
    await webviews.open({ kind: 'importLink', link: 'x' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('labshelf.library.focus');
    expect(sidebar.post).not.toHaveBeenCalled();
    sidebar.send(hello);
    expect(sidebar.post).toHaveBeenCalledTimes(1);
    expect(sidebar.post).toHaveBeenCalledWith({ channel: 'sharing', type: 'open', request: { kind: 'importLink', link: 'x' } });
  });

  it('posts at once to a ready webview, and waits again after it is disposed', async () => {
    const webviews = new SharingWebviews();
    const first = fakeWebview();
    const attached = webviews.attach(first.webview, { opensDialogs: true });
    first.send(hello);
    await webviews.open({ kind: 'manageLinks' });
    expect(first.post).toHaveBeenCalledTimes(1);
    attached.dispose();
    await webviews.open({ kind: 'joinProject' });
    expect(first.post).toHaveBeenCalledTimes(1);
    const second = fakeWebview();
    webviews.attach(second.webview, { opensDialogs: true });
    second.send(hello);
    expect(second.post).toHaveBeenCalledWith({ channel: 'sharing', type: 'open', request: { kind: 'joinProject' } });
  });

  it('serves nothing until serving starts, then every attached webview now and later', () => {
    const webviews = new SharingWebviews();
    const early = fakeWebview();
    const stopEarly = webviews.attach(early.webview);
    const stops = new Map<vscode.Webview, jest.Mock>();
    const serveOn = jest.fn((webview: vscode.Webview) => { const stop = jest.fn(); stops.set(webview, stop); return new vscode.Disposable(stop); });
    expect(serveOn).not.toHaveBeenCalled();
    webviews.serve(serveOn);
    expect(serveOn).toHaveBeenCalledWith(early.webview);
    const late = fakeWebview();
    webviews.attach(late.webview);
    expect(serveOn).toHaveBeenCalledWith(late.webview);
    stopEarly.dispose();
    expect(stops.get(early.webview)).toHaveBeenCalled();
    expect(stops.get(late.webview)).not.toHaveBeenCalled();
  });
});
