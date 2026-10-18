// Mocks vscode.commands with recording registerCommand, executeCommand and getCommands.
module.exports = {
  registerCommand: jest.fn((id, handler) => ({ command: id, handler, dispose: () => {} })),
  executeCommand: jest.fn(async () => undefined),
  getCommands: jest.fn(async () => []),
};
