// Mocks vscode.commands with recording registerCommand and executeCommand.
module.exports = {
  registerCommand: jest.fn((id, handler) => ({ command: id, handler, dispose: () => {} })),
  executeCommand: jest.fn(async () => undefined),
};
