import * as vscode from 'vscode';

import { openAuthorizationUrl } from '../../../src/sync/auth/openAuthorizationUrl';

const URL_TO_OPEN = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&state=s';
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('openAuthorizationUrl', () => {
  it('opens the URL in the browser without showing a message', async () => {
    (vscode.env.openExternal as jest.Mock).mockResolvedValueOnce(true);
    await openAuthorizationUrl(URL_TO_OPEN);
    expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('offers the link, and copies it on request, when the browser does not open', async () => {
    (vscode.env.openExternal as jest.Mock).mockResolvedValueOnce(false);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Copy Link');
    await openAuthorizationUrl(URL_TO_OPEN);
    await flush();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('could not open the browser'), 'Copy Link');
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(URL_TO_OPEN);
  });

  it('offers the link and passes the failure on when openExternal throws', async () => {
    (vscode.env.openExternal as jest.Mock).mockRejectedValueOnce(new Error('no handler'));
    await expect(openAuthorizationUrl(URL_TO_OPEN)).rejects.toThrow('no handler');
    await flush();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
  });
});
