/** The content hash is stored with the AI metadata, so its value must match what earlier runs wrote. */
import * as vscode from 'vscode';
import { hashFile } from '../../../src/ai/pdf/contentHash';

const fileSystemOf = (bytes: Uint8Array) => ({ readFile: jest.fn(async () => bytes) });

describe('hashFile', () => {
  it('returns the lowercase hex SHA-1 of the file bytes', async () => {
    const fileSystem = fileSystemOf(new TextEncoder().encode('abc'));

    expect(await hashFile(vscode.Uri.file('/lib/papers/p1/paper.pdf'), fileSystem)).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(fileSystem.readFile).toHaveBeenCalledWith('/lib/papers/p1/paper.pdf');
  });

  it('pads every byte to two digits and hashes an empty file', async () => {
    expect(await hashFile(vscode.Uri.file('/empty.pdf'), fileSystemOf(new Uint8Array()))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });
});
