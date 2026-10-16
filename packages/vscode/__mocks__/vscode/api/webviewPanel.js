// Mocks the webview panel factory behind window.createWebviewPanel.

function makeWebviewPanel(viewType, title, column, options) {
  const messageListeners = [];
  const disposeListeners = [];
  const viewStateListeners = [];
  const webview = {
    html: '',
    cspSource: 'vscode-resource:',
    options: options || {},
    asWebviewUri: jest.fn((uri) => ({
      toString: () => `vscode-resource:${uri.fsPath || uri.path || uri}`,
    })),
    postMessage: jest.fn(async () => true),
    onDidReceiveMessage: jest.fn((handler) => {
      messageListeners.push(handler);
      return { dispose: () => {} };
    }),
    _fireMessage: (msg) => messageListeners.forEach(l => l(msg)),
  };
  const panel = {
    viewType,
    title,
    webview,
    active: true,
    visible: true,
    viewColumn: column,
    options: options || {},
    reveal: jest.fn(),
    dispose: jest.fn(() => disposeListeners.forEach(l => l())),
    onDidDispose: jest.fn((handler) => {
      disposeListeners.push(handler);
      return { dispose: () => {} };
    }),
    onDidChangeViewState: jest.fn((handler) => {
      viewStateListeners.push(handler);
      return { dispose: () => {} };
    }),
    _disposeListeners: disposeListeners,
  };
  panel._fireViewState = (state) => {
    Object.assign(panel, state);
    viewStateListeners.forEach(l => l({ webviewPanel: panel }));
  };
  return panel;
}

module.exports = makeWebviewPanel;
