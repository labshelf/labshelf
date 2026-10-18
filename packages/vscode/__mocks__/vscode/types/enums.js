// Mocks the numeric and string enums of the vscode API.
const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
};

const ProgressLocation = {
  Notification: 15,
  Window: 10,
  SourceControl: 1,
};

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

const TreeItemCheckboxState = {
  Unchecked: 0,
  Checked: 1,
};

const CodeActionKind = { QuickFix: 'quickfix' };
const CompletionItemKind = { Field: 4, Function: 2, Value: 11, Snippet: 14, Reference: 17 };
const SymbolKind = { Module: 1, Namespace: 2, Class: 4, Property: 6, Field: 7, Struct: 22, Constant: 13 };
const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
const StatusBarAlignment = { Left: 1, Right: 2 };
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
const ViewColumn = { One: 1, Two: 2, Active: -1, Beside: -2 };
const UIKind = { Desktop: 1, Web: 2 };

const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 };

module.exports = {
  FileType,
  UIKind,
  ColorThemeKind,
  ProgressLocation,
  TreeItemCollapsibleState,
  TreeItemCheckboxState,
  CodeActionKind,
  CompletionItemKind,
  SymbolKind,
  DiagnosticSeverity,
  StatusBarAlignment,
  ConfigurationTarget,
  ViewColumn,
  TextEditorRevealType,
};
