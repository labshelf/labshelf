import type { ConflictCopy } from '@labshelf/core';
import { conflictChoices, toolName } from '../../../src/library/conflicts/conflictChoices';

const copy = (name: string): ConflictCopy => ({
  paperId: 'p1', original: `/lib/papers/p1/${name}`, copy: `/lib/papers/p1/${name}.sync-conflict`, tool: 'syncthing',
});

describe('conflictChoices', () => {
  it('offers the three choices for a file', () => {
    expect(conflictChoices(copy('paper.pdf')).map((c) => c.label)).toEqual(['Keep mine', 'Keep the other', 'Keep both']);
  });

  it('omits Keep both for metadata.yaml', () => {
    expect(conflictChoices(copy('metadata.yaml')).map((c) => c.resolution)).toEqual(['keepMine', 'keepOther']);
  });
});

describe('toolName', () => {
  it('names the sync tool', () => {
    expect(toolName('dropbox')).toBe('Dropbox');
  });
});
