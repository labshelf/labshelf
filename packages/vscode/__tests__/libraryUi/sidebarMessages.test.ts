// Tests that the host accepts only well-formed messages from the Library sidebar webview.
import { parseSidebarMessage } from '../../src/libraryUi/sidebarMessages';

describe('parseSidebarMessage', () => {
  it.each([
    [{ type: 'ready' }],
    [{ type: 'refresh' }],
    [{ type: 'openFolder', path: 'papers' }],
    [{ type: 'openFolder', path: 'papers/ml/vision' }],
    [{ type: 'revealPaper', id: 'p1' }],
    [{ type: 'createFolder', path: 'papers/ml' }],
    [{ type: 'addFiles', path: 'papers/ml' }],
    [{ type: 'addFiles', path: 'papers' }],
    [{ type: 'renameFolder', path: 'papers/ml' }],
    [{ type: 'removeFolder', path: 'papers/ml' }],
    [{ type: 'import', path: 'papers/ml', uris: 'file:///a.pdf\nfile:///b.pdf' }],
    [{ type: 'moveFolder', path: 'papers/ml', target: 'papers/vision' }],
    [{ type: 'moveFolder', path: 'papers/ml', target: 'papers' }],
    [{ type: 'openProject', id: '/w/paper' }],
    [{ type: 'projectCommand', id: '/w/paper', command: 'labshelf.writing.reveal' }],
    [{ type: 'projectAction', action: 'browseTemplates' }],
    [{ type: 'projectAction', action: 'newBlank' }],
    [{ type: 'projectAction', action: 'addExisting' }],
  ])('accepts %j', (message) => {
    expect(parseSidebarMessage(message)).toEqual(message);
  });

  it.each([
    ['null', null],
    ['a string', 'ready'],
    ['an unknown type', { type: 'format-disk' }],
    ['no type', {}],
    ['a non-string paper id', { type: 'revealPaper', id: 7 }],
    ['a path outside papers', { type: 'createFolder', path: '/etc' }],
    ['a sibling of papers', { type: 'openFolder', path: 'papers-extra/x' }],
    ['a path that climbs out', { type: 'removeFolder', path: 'papers/../secret' }],
    ['a dot segment', { type: 'renameFolder', path: 'papers/./ml' }],
    ['a removed share message', { type: 'shareFolder', path: 'papers/ml' }],
    ['a removed join action', { type: 'projectAction', action: 'joinShared' }],
    ['an empty segment', { type: 'openFolder', path: 'papers//ml' }],
    ['a trailing slash', { type: 'openFolder', path: 'papers/ml/' }],
    ['a missing path', { type: 'openFolder' }],
    ['add files into a bad path', { type: 'addFiles', path: '/etc' }],
    ['non-string uris', { type: 'import', path: 'papers/ml', uris: ['file:///a.pdf'] }],
    ['an import into a bad path', { type: 'import', path: 'ml', uris: '' }],
    ['a move target outside papers', { type: 'moveFolder', path: 'papers/ml', target: '/tmp' }],
    ['a move target that climbs out', { type: 'moveFolder', path: 'papers/ml', target: 'papers/..' }],
    ['a missing move target', { type: 'moveFolder', path: 'papers/ml' }],
    ['a non-string project id', { type: 'openProject', id: 3 }],
    ['a project command that is not on the menu', { type: 'projectCommand', id: '/w/paper', command: 'workbench.action.quit' }],
    ['a project command without an id', { type: 'projectCommand', command: 'labshelf.writing.reveal' }],
    ['an unknown project action', { type: 'projectAction', action: 'format' }],
  ])('rejects %s', (_name, message) => {
    expect(parseSidebarMessage(message)).toBeNull();
  });
});


describe('Space messages', () => {
  const messages = [
    { type: 'spaceAction', action: 'openCatalog' },
    { type: 'spaceAction', action: 'newSpace' },
    { type: 'spaceAction', action: 'openSpace', id: 's', folder: 'f' },
    { type: 'spaceAction', action: 'openPaper', id: 'p' },
    { type: 'spaceAction', action: 'renameSpace', id: 's' },
    { type: 'spaceAction', action: 'deleteSpace', id: 's' },
    { type: 'spaceAction', action: 'newFolder', spaceId: 's', parent: 'f' },
    { type: 'spaceAction', action: 'renameFolder', spaceId: 's', folder: 'f' },
    { type: 'spaceAction', action: 'deleteFolder', spaceId: 's', folder: 'f' },
    { type: 'spaceAction', action: 'dropPapers', spaceId: 's', paperIds: ['p'] },
    { type: 'spaceAction', action: 'removeReference', spaceId: 's', paperId: 'p' },
  ];
  it.each(messages)('accepts $action', (message) => expect(parseSidebarMessage(message)).toEqual(message));
  it.each([
    { action: 'unknown' }, { action: 'openSpace' }, { action: 'openPaper', id: 1 },
    { action: 'renameSpace', id: '' }, { action: 'deleteSpace', id: '../s' },
    { action: 'newFolder', spaceId: 's', parent: 3 },
    { action: 'renameFolder', spaceId: 's' }, { action: 'deleteFolder', spaceId: 's', folder: '' },
    { action: 'dropPapers', spaceId: 's', paperIds: ['p', 1] },
    { action: 'dropPapers', spaceId: 's', paperIds: [] },
    { action: 'dropPapers', spaceId: 's', paperIds: ['p'], folder: 1 },
    { action: 'removeReference', spaceId: 's', paperId: '' },
  ])('rejects malformed $action', (fields) => expect(parseSidebarMessage({ type: 'spaceAction', ...fields })).toBeNull());
});
