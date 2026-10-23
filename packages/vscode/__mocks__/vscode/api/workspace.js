// Mocks vscode.workspace: file system, configuration, watchers and document events.
const fs = require('fs');
const { FileType } = require('../types/enums');

const workspaceFs = {
  readFile: jest.fn(async (uri) => Buffer.from(fs.readFileSync(uri.fsPath))),
  writeFile: jest.fn(async () => {}),
  stat: jest.fn(async (uri) => ({ type: FileType.File, ctime: 0, mtime: 0, size: 0 })),
  readDirectory: jest.fn(async (_uri) => []),
  createDirectory: jest.fn(async () => {}),
  delete: jest.fn(async () => {}),
  rename: jest.fn(async () => {}),
};

// Settings returned by getConfiguration(section).get(key); tests assign `workspace._config['labshelf.reader'] = {...}`.
const _config = {};
const _configListeners = [];

const workspace = {
  fs: workspaceFs,
  workspaceFolders: undefined,
  _config,
  _configUpdate: jest.fn(async () => {}),
  getConfiguration: jest.fn((section) => ({
    get: (key, fallback) => {
      const value = (_config[section] || {})[key];
      return value === undefined ? fallback : value;
    },
    update: (...args) => workspace._configUpdate(section, ...args),
  })),
  onDidChangeConfiguration: jest.fn((handler) => {
    _configListeners.push(handler);
    return { dispose: () => {
      const idx = _configListeners.indexOf(handler);
      if (idx >= 0) _configListeners.splice(idx, 1);
    }};
  }),
  _fireConfigChange: (section) => _configListeners.forEach(l => l({
    affectsConfiguration: (s) => s === section || section.startsWith(`${s}.`),
  })),
};

class RelativePattern {
  constructor(base, pattern) { this.base = base; this.pattern = pattern; }
}

// Every watcher created, so tests can fire file events: `_fileWatchers[0]._fire('change', Uri.file(...))`.
const _fileWatchers = [];
workspace.createFileSystemWatcher = jest.fn((pattern) => {
  const listeners = { create: [], change: [], delete: [] };
  const on = (kind) => (cb) => { listeners[kind].push(cb); return { dispose: () => {} }; };
  const watcher = {
    pattern,
    onDidCreate: on('create'),
    onDidChange: on('change'),
    onDidDelete: on('delete'),
    dispose: jest.fn(),
    _fire: (kind, uri) => listeners[kind].forEach((cb) => cb(uri)),
  };
  _fileWatchers.push(watcher);
  return watcher;
});

// Handlers registered with workspace.onDidChangeTextDocument; tests call workspace._fireTextDocumentChange(event).
const _textChangeListeners = [];
workspace.onDidChangeTextDocument = jest.fn((handler) => {
  _textChangeListeners.push(handler);
  return { dispose: () => { _textChangeListeners.splice(_textChangeListeners.indexOf(handler), 1); } };
});
workspace._fireTextDocumentChange = (event) => _textChangeListeners.forEach((l) => l(event));

workspace.textDocuments = [];
workspace.applyEdit = jest.fn(async () => true);
workspace.saveAll = jest.fn(async () => true);

// Handlers per document event; tests call workspace._fireDocumentEvent("save" | "open" | "close", document).
const _documentListeners = { save: [], open: [], close: [] };
const onDocumentEvent = (kind) => jest.fn((handler) => {
  _documentListeners[kind].push(handler);
  return { dispose: () => { _documentListeners[kind].splice(_documentListeners[kind].indexOf(handler), 1); } };
});
workspace.onWillSaveTextDocument = jest.fn(() => ({ dispose: () => {} }));
workspace.onDidSaveTextDocument = onDocumentEvent('save');
workspace.onDidOpenTextDocument = onDocumentEvent('open');
workspace.onDidCloseTextDocument = onDocumentEvent('close');
workspace._fireDocumentEvent = (kind, document) => _documentListeners[kind].forEach((l) => l(document));

module.exports = { workspace, RelativePattern, _fileWatchers };
