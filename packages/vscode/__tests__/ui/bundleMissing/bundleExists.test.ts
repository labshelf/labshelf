import * as vscode from 'vscode';
import { bundleExists } from '../../../src/ui/bundleMissing/index';

describe('bundleExists', () => {
  it('is true when the file system finds the file and false when it throws', async () => {
    const stat = vscode.workspace.fs.stat as jest.Mock;
    const uri = vscode.Uri.file('/ext/dist/library/library.js');

    stat.mockResolvedValueOnce({ type: vscode.FileType.File });
    expect(await bundleExists(uri)).toBe(true);
    expect(stat).toHaveBeenCalledWith(uri);

    stat.mockRejectedValueOnce(new Error('FileNotFound'));
    expect(await bundleExists(uri)).toBe(false);
  });
});
