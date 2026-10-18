// Mocks vscode.env with the desktop UI kind, a clipboard and openExternal.
module.exports = {
  uiKind: 1,
  clipboard: { writeText: jest.fn(async () => {}), readText: jest.fn(async () => '') },
  openExternal: jest.fn(async () => true),
};
