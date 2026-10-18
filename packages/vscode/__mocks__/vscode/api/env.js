// Mocks vscode.env with a clipboard and openExternal.
module.exports = {
  clipboard: { writeText: jest.fn(async () => {}), readText: jest.fn(async () => '') },
  openExternal: jest.fn(async () => true),
};
