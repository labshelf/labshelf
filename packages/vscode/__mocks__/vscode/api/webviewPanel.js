// Mocks the webview panel factory behind window.createWebviewPanel, and the custom editor registry tests drive with a panel of their own.

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
    dispose: jest.fn(() => [...disposeListeners].forEach(l => l())),
    // As in VS Code, the subscription joins the given disposables and disposing it removes the listener.
    onDidDispose: jest.fn((handler, _thisArg, disposables) => {
      disposeListeners.push(handler);
      const subscription = { dispose: () => { const at = disposeListeners.indexOf(handler); if (at >= 0) { disposeListeners.splice(at, 1); } } };
      disposables?.push(subscription);
      return subscription;
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

// Custom editor providers by view type; `_resolveCustomEditor(viewType, document)` opens a panel on the document as VS Code does and returns it.
const customEditorProviders = new Map();
makeWebviewPanel.registerCustomEditorProvider = jest.fn((viewType, provider, options) => {
  customEditorProviders.set(viewType, { provider, options });
  return { dispose: () => { if (customEditorProviders.get(viewType)?.provider === provider) customEditorProviders.delete(viewType); } };
});
makeWebviewPanel._customEditorProviders = customEditorProviders;
makeWebviewPanel._resolveCustomEditor = async (viewType, document) => {
  const registered = customEditorProviders.get(viewType);
  if (!registered) throw new Error(`No custom editor provider for ${viewType}`);
  const panel = makeWebviewPanel(viewType, document.fileName || String(document.uri), 1, registered.options?.webviewOptions);
  await registered.provider.resolveCustomTextEditor(document, panel, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });
  return panel;
};

module.exports = makeWebviewPanel;
