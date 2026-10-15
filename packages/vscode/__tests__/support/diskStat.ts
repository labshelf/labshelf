// Makes the mocked workspace.fs.stat answer from the real disk, for tests that build a bundle in a temp folder.
import * as fs from 'node:fs';
import * as vscode from 'vscode';

export function statFromDisk(): void {
  (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
    try {
      const stat = fs.statSync(uri.fsPath);
      return { type: stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File, ctime: 0, mtime: 0, size: stat.size };
    } catch (error) {
      throw Object.assign(new Error('FileNotFound'), { code: 'FileNotFound', cause: error });
    }
  });
}
