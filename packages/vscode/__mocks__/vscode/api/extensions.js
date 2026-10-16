// Mocks vscode.extensions with no installed extensions.
module.exports = { getExtension: jest.fn(() => undefined) };
