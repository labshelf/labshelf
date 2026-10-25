/** The installed pdfjs-dist is found through Node resolution, with its package root for the webview. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { locatePdfjs } from '../../../src/reader/node/pdfjsDir';

describe('locatePdfjs', () => {
  it('returns existing pdf.js files and the pdfjs-dist package root', () => {
    const files = locatePdfjs();

    expect(files).not.toBeNull();
    for (const uri of [files!.pdfjs, files!.worker, files!.viewer, files!.viewerCss]) {
      expect(fs.existsSync(uri.fsPath)).toBe(true);
    }
    expect(path.basename(files!.root.fsPath)).toBe('pdfjs-dist');
    expect(fs.existsSync(path.join(files!.root.fsPath, 'cmaps'))).toBe(true);
  });
});
