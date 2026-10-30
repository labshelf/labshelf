// Mocks vscode.window: messages, dialogs, editors, tabs, status bar and theme events.
const { ColorThemeKind } = require('../types/enums');
const makeWebviewPanel = require('./webviewPanel');

const _themeChangeListeners = [];

const window = {
  showOpenDialog: jest.fn(async () => undefined),
  showWarningMessage: jest.fn(async () => undefined),
  showInformationMessage: jest.fn(async () => undefined),
  showErrorMessage: jest.fn(async () => undefined),
  setStatusBarMessage: jest.fn(() => ({ dispose: () => {} })),
  withProgress: jest.fn(async (_options, task) => task({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) })),
  createOutputChannel: jest.fn(() => ({ append: jest.fn(), appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn() })),
  registerTreeDataProvider: jest.fn(() => ({ dispose: () => {} })),
  createTreeView: jest.fn(() => ({
    dispose: () => {},
    onDidChangeSelection: jest.fn(),
    onDidExpandElement: jest.fn(),
    onDidCollapseElement: jest.fn(),
    onDidChangeCheckboxState: jest.fn(),
  })),
  showInputBox: jest.fn(async () => undefined),
  showQuickPick: jest.fn(async () => undefined),
  showSaveDialog: jest.fn(async () => undefined),
  registerWebviewViewProvider: jest.fn(() => ({ dispose: () => {} })),
  registerUriHandler: jest.fn(() => ({ dispose: () => {} })),
  showTextDocument: jest.fn(async () => ({ revealRange: jest.fn() })),
  createWebviewPanel: jest.fn((viewType, title, column, options) => makeWebviewPanel(viewType, title, column, options)),
  registerCustomEditorProvider: makeWebviewPanel.registerCustomEditorProvider,
  activeColorTheme: { kind: ColorThemeKind.Dark },
  onDidChangeActiveColorTheme: jest.fn((handler) => {
    _themeChangeListeners.push(handler);
    return { dispose: () => {
      const idx = _themeChangeListeners.indexOf(handler);
      if (idx >= 0) _themeChangeListeners.splice(idx, 1);
    }};
  }),
  _fireThemeChange: (kind) => _themeChangeListeners.forEach(l => l({ kind })),
};

window.createStatusBarItem = jest.fn(() => ({
  text: '', tooltip: '', command: undefined, show: jest.fn(), hide: jest.fn(), dispose: jest.fn(),
}));

// Tests set `window.activeTextEditor` and call `window._fireActiveEditorChange()`.
const _activeEditorListeners = [];
window.activeTextEditor = undefined;
window.onDidChangeActiveTextEditor = jest.fn((handler) => {
  _activeEditorListeners.push(handler);
  return { dispose: () => { _activeEditorListeners.splice(_activeEditorListeners.indexOf(handler), 1); } };
});
window._fireActiveEditorChange = () => _activeEditorListeners.forEach((l) => l(window.activeTextEditor));

// Tests call `window._fireSelectionChange()` after moving the active editor's selection.
const _selectionListeners = [];
window.onDidChangeTextEditorSelection = jest.fn((handler) => {
  _selectionListeners.push(handler);
  return { dispose: () => { _selectionListeners.splice(_selectionListeners.indexOf(handler), 1); } };
});
window._fireSelectionChange = () => _selectionListeners.forEach((l) => l({ textEditor: window.activeTextEditor }));
window.visibleTextEditors = [];

// Tests fill `window.tabGroups.all` with groups of `{ input: new TabInputText(uri) }` tabs.
window.tabGroups = { all: [], close: jest.fn(async () => true) };

module.exports = window;
