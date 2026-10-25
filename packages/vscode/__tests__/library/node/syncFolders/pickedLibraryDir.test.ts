import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { libraryTargetFolder } from '../../../../src/library/node/syncFolders/pickedLibraryDir';
import { displayPath } from '../../../../src/library/node/syncFolders/showPath';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-target-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('libraryTargetFolder', () => {
  it('uses an empty folder as it is', async () => {
    expect(await libraryTargetFolder(dir)).toBe(dir);
  });

  it('uses a folder that does not exist yet as it is', async () => {
    const missing = path.join(dir, 'new');
    expect(await libraryTargetFolder(missing)).toBe(missing);
  });

  it('creates the library in a LabShelf subfolder when the folder holds other files', async () => {
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    expect(await libraryTargetFolder(dir)).toBe(path.join(dir, 'LabShelf'));
  });

  it('opens a folder that is already a library', async () => {
    fs.mkdirSync(path.join(dir, '.research'));
    fs.mkdirSync(path.join(dir, 'papers'));
    fs.writeFileSync(path.join(dir, 'other.txt'), 'x');
    expect(await libraryTargetFolder(dir)).toBe(dir);
  });
});

describe('displayPath', () => {
  it('abbreviates the home folder', () => {
    expect(displayPath('/home/me', '/home/me')).toBe('~');
    expect(displayPath('/home/me/Dropbox/LabShelf', '/home/me')).toBe('~/Dropbox/LabShelf');
  });

  it('keeps paths outside the home folder', () => {
    expect(displayPath('/mnt/x', '/home/me')).toBe('/mnt/x');
  });
});
