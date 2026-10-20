/** The share-link palette commands open their sharing dialog, with a Library view folder mapped to its library path. */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { sharingWebviews } from '../../../src/sharing/index';
import { registerShareLinks } from '../../../src/share/node/registerShareLinks';

jest.mock('../../../src/sharing/index', () => ({ sharingWebviews: { open: jest.fn(async () => undefined) } }));

const papersRoot = path.join(path.sep, 'lib', 'papers');
const services = { mutations: { papersRoot, paths: { sep: path.sep, join: path.join } } };

function commandHandler(id: string): (...args: unknown[]) => Promise<void> {
  const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([name]) => name === id);
  return call[1];
}

describe('registerShareLinks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerShareLinks({ subscriptions: [] } as unknown as vscode.ExtensionContext, { require: async () => services } as never);
  });

  it('opens the share folder dialog on the library path of the folder node', async () => {
    await commandHandler('labshelf.share.folder')({ dirPath: path.join(papersRoot, 'ML', '2024') });
    expect(sharingWebviews.open).toHaveBeenCalledWith({ kind: 'shareFolder', path: 'papers/ML/2024' });
  });

  it('opens the share folder dialog without a path for the papers root or no node', async () => {
    await commandHandler('labshelf.share.folder')({ dirPath: papersRoot });
    await commandHandler('labshelf.share.folder')();
    expect((sharingWebviews.open as jest.Mock).mock.calls).toEqual([[{ kind: 'shareFolder' }], [{ kind: 'shareFolder' }]]);
  });

  it('opens the manage and import dialogs, passing the link it was given', async () => {
    await commandHandler('labshelf.share.manage')();
    await commandHandler('labshelf.share.import')('https://x/share/#k');
    expect((sharingWebviews.open as jest.Mock).mock.calls).toEqual([[{ kind: 'manageLinks' }], [{ kind: 'importLink', link: 'https://x/share/#k' }]]);
  });
});
