import { checkFolderNameInput } from '../../src/libraryUi/organizer';

describe('checkFolderNameInput', () => {
  it('accepts an ordinary name', () => {
    expect(checkFolderNameInput('Reading group')).toBeNull();
  });

  it.each(['', '  ', '.', '..', '.hidden', 'a/b', 'a\\b', 'bad\u0001name', 'a'.repeat(256)])('rejects %j with a message', (name) => {
    expect(checkFolderNameInput(name)).toEqual(expect.any(String));
  });
});
