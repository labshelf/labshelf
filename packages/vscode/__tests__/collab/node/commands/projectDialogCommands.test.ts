/** The share, join and leave project commands open their sharing dialog once a library is open. */
import * as vscode from 'vscode';
import { sharingWebviews } from '../../../../src/sharing/index';
import { registerProjectDialogCommands } from '../../../../src/collab/node/commands/projectDialogCommands';

jest.mock('../../../../src/sharing/index', () => ({ sharingWebviews: { open: jest.fn(async () => undefined) } }));

function commandHandler(id: string): (...args: unknown[]) => Promise<void> {
  const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([name]) => name === id);
  return call[1];
}

describe('registerProjectDialogCommands', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the folder of a project entry or a folder path as the project id', async () => {
    registerProjectDialogCommands(async () => '/lib');
    await commandHandler('labshelf.collab.share')({ kind: 'ready', folder: '/lib/projects/thesis' });
    await commandHandler('labshelf.collab.leave')('/lib/projects/thesis');
    await commandHandler('labshelf.collab.join')('labshelf-invite');
    await commandHandler('labshelf.collab.share')(vscode.Uri.file('/elsewhere'));
    expect((sharingWebviews.open as jest.Mock).mock.calls).toEqual([
      [{ kind: 'shareProject', projectId: '/lib/projects/thesis' }],
      [{ kind: 'leaveProject', projectId: '/lib/projects/thesis' }],
      [{ kind: 'joinProject', invite: 'labshelf-invite' }],
      [{ kind: 'shareProject' }],
    ]);
  });

  it('opens nothing when no library is open', async () => {
    registerProjectDialogCommands(async () => undefined);
    await commandHandler('labshelf.collab.join')();
    expect(sharingWebviews.open).not.toHaveBeenCalled();
  });
});
