// Checks the choices offered for conflict copies.
import type { ConflictCopy } from '@labshelf/core';
import { conflictChoices, toolName } from '../../../src/library/conflicts/conflictChoices';

const copy = (name: string): ConflictCopy => ({
  owner: { kind: 'paper', id: 'p1' }, original: `/lib/papers/p1/${name}`, copy: `/lib/papers/p1/${name}.sync-conflict`, tool: 'syncthing',
});

describe('conflictChoices', () => {
  it("offers the content-match question's three choices", () => {
    const content = { ...copy("main.tex"), owner: { kind: "project" as const, id: "draft" }, match: "similar", tool: "unknown" } as ConflictCopy;
    expect(conflictChoices(content).map((choice) => choice.label)).toEqual(["Merge Automatically", "Merge Myself", "Not a Version"]);
    expect(conflictChoices(content).map((choice) => choice.resolution)).toEqual(["mergeAutomatically", "mergeMyself", "notAVersion"]);
  });

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
