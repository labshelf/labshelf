// Mocks language-feature value types and the vscode.languages namespace.

class CodeAction {
  constructor(title, kind) { this.title = title; this.kind = kind; }
}

class MarkdownString {
  constructor(value) { this.value = value || ''; this.isTrusted = undefined; }
  appendMarkdown(text) { this.value += text; return this; }
  appendText(text) { this.value += text; return this; }
}

class Hover {
  constructor(contents, range) { this.contents = contents; this.range = range; }
}

class DocumentLink {
  constructor(range, target) { this.range = range; this.target = target; }
}

class CompletionItem {
  constructor(label, kind) { this.label = label; this.kind = kind; }
}

class SnippetString {
  constructor(value) { this.value = value || ''; }
}


class DocumentSymbol {
  constructor(name, detail, kind, range, selectionRange) {
    Object.assign(this, { name, detail, kind, range, selectionRange, children: [] });
  }
}

class Diagnostic {
  constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; }
}

const languages = {
  createDiagnosticCollection: jest.fn(() => ({ set: jest.fn(), delete: jest.fn(), dispose: jest.fn() })),
  registerCompletionItemProvider: jest.fn(() => ({ dispose: () => {} })),
  registerHoverProvider: jest.fn(() => ({ dispose: () => {} })),
  registerDocumentLinkProvider: jest.fn(() => ({ dispose: () => {} })),
  registerDefinitionProvider: jest.fn(() => ({ dispose: () => {} })),
  registerDocumentSymbolProvider: jest.fn(() => ({ dispose: () => {} })),
  registerCodeActionsProvider: jest.fn(() => ({ dispose: () => {} })),
};

class WebviewPanel {}

module.exports = {
  CodeAction, MarkdownString, Hover, DocumentLink, CompletionItem, SnippetString,
  DocumentSymbol, Diagnostic, WebviewPanel, languages,
};
